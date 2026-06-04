/**
 * Confidence-scored device classification — the deterministic fusion layer.
 * See docs/device-classification.md. Server-side (pulls the ~1MB OUI registry
 * via lib/oui); pure functions, no I/O.
 *
 * `gatherCandidates()` turns each available signal into a scored Candidate;
 * `fuse()` combines them (strongest signal per type + an agreement bonus when
 * independent signals concur) into one Verdict with a 0–1 confidence, full
 * provenance, and a `needsAi` flag (true when confidence is low or the top two
 * types conflict). The AI adjudicator and the `device_classifications` table
 * build on top of this — this module is the foundation both depend on.
 *
 * Server/CLI only (pulls the ~1MB OUI registry via lib/oui) — same convention as
 * lib/oui: documented, not enforced with `server-only`, so the tsx ingest/enrich
 * scripts can import it.
 */
import { createHash } from "node:crypto";

import {
  classifyByDhcpFingerprint,
  classifyByDhcpVendor,
  classifyByHostname,
  classifyBySnmpDescr,
  classifyByVendorName,
  isBlankVendor,
  isLocallyAdministered,
  lookupVendor,
  type DeviceType,
} from "@/lib/oui";

export interface Candidate {
  type: DeviceType;
  score: number;
  signal: string;
  source: string;
}

export interface Verdict {
  type: DeviceType;
  confidence: number;
  method: "deterministic" | "ai" | "confirmed";
  sources: Candidate[];
  /** True when the deterministic result is weak/conflicting → escalate to AI. */
  needsAi: boolean;
  /** Stable hash of the signal set — AI cache key + change detector. */
  signalHash: string;
}

export interface ClassifyInput {
  mac?: string | null;
  vendor?: string | null;
  hostname?: string | null;
  snmpSysDescr?: string | null;
  lldpDescr?: string | null;
  dhcpVendorClass?: string | null;
  /** DHCP option-55 parameter request list. Unused until the opt-55 matcher lands. */
  dhcpParamList?: string | null;
}

// Base confidence per signal (docs/device-classification.md §3). SNMP/LLDP come
// from managed gear and are strong; OUI vendor-name is weak (vendor ≠ role).
const WEIGHT = {
  snmp: 0.85,
  lldp: 0.8,
  dhcp: 0.7, // option-60 vendor class
  dhcpFp: 0.65, // option-55 fingerprint (seed data is stale ODbL — hedge slightly)
  hostname: 0.5,
  oui: 0.4,
} as const;

const AGREE_BONUS = 0.06; // per extra independent signal that agrees
const AGREE_CAP = 3; // …capped, so a pile-on can't certainty-inflate
export const AI_THRESHOLD = 0.75; // top confidence below this → escalate
const CONFLICT_MARGIN = 0.1; // top-2 within this AND different type → escalate
const MAX_DET = 0.99; // deterministic confidence ceiling (1.0 = human-confirmed only)

/** Turn every available signal into a scored candidate (drops null/unknown). */
export function gatherCandidates(input: ClassifyInput): Candidate[] {
  const out: Candidate[] = [];
  const push = (type: DeviceType | null, score: number, signal: string, source: string) => {
    if (type && type !== "unknown") out.push({ type, score, signal, source });
  };

  push(classifyBySnmpDescr(input.snmpSysDescr), WEIGHT.snmp, "snmp.sysDescr", "snmp");
  push(classifyBySnmpDescr(input.lldpDescr), WEIGHT.lldp, "lldp.sysDescr", "lldp");
  push(classifyByDhcpVendor(input.dhcpVendorClass), WEIGHT.dhcp, "dhcp.opt60", "dhcp");
  push(classifyByDhcpFingerprint(input.dhcpParamList), WEIGHT.dhcpFp, "dhcp.opt55", "dhcp");
  push(classifyByHostname(input.hostname), WEIGHT.hostname, "hostname", "hostname");
  const vendor = input.vendor ?? lookupVendor(input.mac);
  push(classifyByVendorName(vendor), WEIGHT.oui, "oui.vendorName", "oui");

  return out;
}

/** Fuse scored candidates into a single verdict. */
export function fuse(cands: Candidate[], mac?: string | null): Omit<Verdict, "signalHash"> {
  if (cands.length === 0) {
    // No positive signal: distinguish a privacy-randomized MAC from plain unknown.
    const type: DeviceType =
      isLocallyAdministered(mac) && !lookupVendor(mac) ? "randomized" : "unknown";
    return { type, confidence: 0, method: "deterministic", sources: [], needsAi: type === "unknown" };
  }

  // Best signal per candidate type, plus a bonus for each *additional* independent
  // signal that agrees on that type.
  const byType = new Map<DeviceType, Candidate[]>();
  for (const c of cands) {
    const arr = byType.get(c.type) ?? [];
    arr.push(c);
    byType.set(c.type, arr);
  }

  const scored = [...byType.entries()]
    .map(([type, cs]) => {
      const best = Math.max(...cs.map((c) => c.score));
      const agree = Math.min(cs.length - 1, AGREE_CAP) * AGREE_BONUS;
      return { type, confidence: Math.min(MAX_DET, best + agree), supporting: cs };
    })
    .sort((a, b) => b.confidence - a.confidence);

  const top = scored[0];
  const runnerUp = scored[1];
  const conflict = !!runnerUp && top.confidence - runnerUp.confidence < CONFLICT_MARGIN;

  return {
    type: top.type,
    confidence: top.confidence,
    method: "deterministic",
    sources: top.supporting,
    needsAi: top.confidence < AI_THRESHOLD || conflict,
  };
}

/** Stable hash of the normalized signal set — AI cache key + change detector. */
export function signalHashFor(input: ClassifyInput): string {
  const norm = (s?: string | null) => (s ?? "").trim().toLowerCase();
  const canon = JSON.stringify({
    mac: norm(input.mac).replace(/[^0-9a-f]/g, "").slice(0, 12),
    vendor: norm(input.vendor),
    hostname: norm(input.hostname),
    snmp: norm(input.snmpSysDescr),
    lldp: norm(input.lldpDescr),
    dhcpVc: norm(input.dhcpVendorClass),
    dhcpPrl: norm(input.dhcpParamList),
  });
  return createHash("sha256").update(canon).digest("hex");
}

/** One-shot: gather → fuse → hash. */
export function classify(input: ClassifyInput): Verdict {
  const verdict = fuse(gatherCandidates(input), input.mac);
  return { ...verdict, signalHash: signalHashFor(input) };
}

const RANDOMIZED_VENDOR = "Randomized (private) MAC";

export interface HostClassification {
  vendor: string | null;
  deviceType: DeviceType;
  confidence: number;
  method: Verdict["method"];
  sources: Candidate[];
  signalHash: string;
  needsAi: boolean;
}

/**
 * Ingest/backfill helper for entities_host: resolve vendor from OUI when the
 * bundle's vendor is blank, run the scored classifier, and return vendor +
 * deviceType + the scored fields in one shot. Drop-in replacement for the old
 * `enrichHost` (same vendor/deviceType shape, plus confidence/method/sources/hash).
 */
export function classifyHost(input: ClassifyInput): HostClassification {
  const resolvedVendor = isBlankVendor(input.vendor)
    ? lookupVendor(input.mac)
    : (input.vendor ?? null);
  const v = classify({ ...input, vendor: resolvedVendor });
  const vendor =
    !resolvedVendor && v.type === "randomized" ? RANDOMIZED_VENDOR : resolvedVendor;
  return {
    vendor: vendor ?? null,
    deviceType: v.type,
    confidence: v.confidence,
    method: v.method,
    sources: v.sources,
    signalHash: v.signalHash,
    needsAi: v.needsAi,
  };
}
