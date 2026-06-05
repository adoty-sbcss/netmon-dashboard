/**
 * AI adjudication for low-confidence / conflicting device classifications.
 * See docs/device-classification.md §4–§5. Only the hard cases reach the model;
 * identical fingerprints reuse a cached verdict (keyed by class_signal_hash), so
 * cost scales with DISTINCT ambiguous devices, not device count.
 *
 * Provider-agnostic: the model call (`CallModel`) and the budget check
 * (`WithinBudget`) are INJECTED, so this runner is fully testable and the actual
 * wiring to the AI seam (src/lib/ai) + the monthly spend cap happens at the Job
 * entry point. Server/CLI only (touches the DB) — import from a Job, not a client.
 */
import { and, eq, isNull, isNotNull, lt } from "drizzle-orm";

import { db } from "@/db";
import { entitiesHost } from "@/db/schema";
import { dhcpObservations } from "@/db/schema/netmon";
import { DEVICE_TYPE_LABELS, type DeviceType } from "@/lib/oui";

import { AI_THRESHOLD, type Candidate } from "./index";

/** The model must return exactly this shape (JSON), citing the signals it used. */
export interface AdjudicatorVerdict {
  device_type: DeviceType;
  model: string | null;
  os: string | null;
  confidence: number; // 0..1, the model's own confidence
  cited_signals: string[];
  rationale: string;
}

/** Inject the real provider call here (e.g. a thin wrapper over src/lib/ai). */
export type CallModel = (prompt: { instructions: string; context: string }) => Promise<string>;
/** Inject the monthly-spend-cap check; default lets everything through. */
export type WithinBudget = () => Promise<boolean> | boolean;

const VALID_TYPES = new Set(Object.keys(DEVICE_TYPE_LABELS));
const AI_CONF_CEIL = 0.9; // AI verdicts cap below 1.0 (human-confirmed only = 1.0)

export const ADJUDICATOR_INSTRUCTIONS = [
  "You classify a single network device from passive fingerprint evidence.",
  "Pick the SINGLE most likely device_type from this exact set:",
  `  ${[...VALID_TYPES].join(", ")}.`,
  "Rules:",
  "- Use ONLY the supplied evidence; do not invent facts.",
  "- cited_signals MUST be a subset of the evidence signal names you actually relied on.",
  "- If the evidence is too thin to decide, return device_type \"unknown\" with low confidence.",
  "- confidence is your own 0..1 estimate.",
  "Respond with ONLY a JSON object, no prose, no code fence:",
  '{"device_type":"...","model":null,"os":null,"confidence":0.0,"cited_signals":[],"rationale":"..."}',
].join("\n");

interface Evidence {
  mac: string;
  vendor: string | null;
  hostname: string | null;
  dhcpVendorClass: string | null;
  dhcpParamList: string | null;
  serviceHint?: string | null;
  services?: string[] | null;
  candidates: Candidate[];
}

/** Compile the evidence into the compact context string the model reads. */
export function buildEvidence(e: Evidence): string {
  const lines: string[] = [];
  lines.push(`mac: ${e.mac}`);
  if (e.vendor) lines.push(`oui.vendor: ${e.vendor}`);
  if (e.hostname) lines.push(`hostname: ${e.hostname}`);
  if (e.serviceHint) lines.push(`mdns.hint (advertised service class): ${e.serviceHint}`);
  if (e.services?.length) lines.push(`mdns.services: ${e.services.join(", ")}`);
  if (e.dhcpVendorClass) lines.push(`dhcp.opt60 (vendor class): ${e.dhcpVendorClass}`);
  if (e.dhcpParamList) lines.push(`dhcp.opt55 (param request list): ${e.dhcpParamList}`);
  if (e.candidates.length) {
    lines.push("deterministic candidates (signal → type @ score):");
    for (const c of e.candidates) lines.push(`  ${c.signal} → ${c.type} @ ${c.score.toFixed(2)}`);
  } else {
    lines.push("deterministic candidates: none (no rule matched)");
  }
  return lines.join("\n");
}

/** Parse + validate the model's JSON response. Returns null if unusable. */
export function parseVerdict(text: string): AdjudicatorVerdict | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const type = String(o.device_type ?? "");
  if (!VALID_TYPES.has(type)) return null;
  const confRaw = typeof o.confidence === "number" ? o.confidence : Number(o.confidence);
  const confidence = Number.isFinite(confRaw) ? Math.max(0, Math.min(1, confRaw)) : 0.5;
  return {
    device_type: type as DeviceType,
    model: typeof o.model === "string" && o.model.trim() ? o.model.trim() : null,
    os: typeof o.os === "string" && o.os.trim() ? o.os.trim() : null,
    confidence,
    cited_signals: Array.isArray(o.cited_signals) ? o.cited_signals.map(String) : [],
    rationale: typeof o.rationale === "string" ? o.rationale.slice(0, 500) : "",
  };
}

export interface AdjudicateResult {
  examined: number;
  cached: number;
  adjudicated: number;
  skippedBudget: number;
  failed: number;
}

/**
 * Find low-confidence, not-human-confirmed hosts and resolve their type via the
 * injected model — reusing a cached verdict when an identical signalHash was
 * already adjudicated. Writes back device_type + class_confidence +
 * class_method='ai' + appended provenance.
 */
export async function adjudicateClassifications(opts: {
  callModel: CallModel;
  withinBudget?: WithinBudget;
  schoolId?: number;
  limit?: number;
}): Promise<AdjudicateResult> {
  const withinBudget = opts.withinBudget ?? (() => true);
  const limit = opts.limit ?? 200;

  const targets = await db
    .select({
      id: entitiesHost.id,
      mac: entitiesHost.mac,
      hostname: entitiesHost.hostname,
      vendor: entitiesHost.vendor,
      deviceType: entitiesHost.deviceType,
      confidence: entitiesHost.classConfidence,
      signalHash: entitiesHost.classSignalHash,
      sources: entitiesHost.classSources,
      attributes: entitiesHost.attributes,
    })
    .from(entitiesHost)
    .where(
      and(
        opts.schoolId != null ? eq(entitiesHost.schoolId, opts.schoolId) : undefined,
        isNull(entitiesHost.excludedAt),
        isNull(entitiesHost.deviceTypeOverride), // never touch human-confirmed
        eq(entitiesHost.classMethod, "deterministic"), // not already AI/confirmed
        lt(entitiesHost.classConfidence, AI_THRESHOLD),
        isNotNull(entitiesHost.classSignalHash),
      ),
    )
    .limit(limit);

  const res: AdjudicateResult = { examined: targets.length, cached: 0, adjudicated: 0, skippedBudget: 0, failed: 0 };
  if (targets.length === 0) return res;

  // DHCP fingerprints for the target MACs (best-effort), for richer evidence.
  const dhcpFp = await buildDhcpFingerprints();

  // Cache: signalHash → resolved verdict (seeded from rows already adjudicated).
  const cache = new Map<string, { type: DeviceType; confidence: number; sources: Candidate[] }>();
  const priorAi = await db
    .select({
      signalHash: entitiesHost.classSignalHash,
      deviceType: entitiesHost.deviceType,
      confidence: entitiesHost.classConfidence,
      sources: entitiesHost.classSources,
    })
    .from(entitiesHost)
    .where(and(eq(entitiesHost.classMethod, "ai"), isNotNull(entitiesHost.classSignalHash)));
  for (const r of priorAi) {
    if (r.signalHash && !cache.has(r.signalHash)) {
      cache.set(r.signalHash, {
        type: (r.deviceType as DeviceType) ?? "unknown",
        confidence: r.confidence ?? AI_CONF_CEIL,
        sources: (r.sources as Candidate[]) ?? [],
      });
    }
  }

  for (const t of targets) {
    const hash = t.signalHash!;
    let resolved = cache.get(hash);

    if (!resolved) {
      if (!(await withinBudget())) {
        res.skippedBudget++;
        continue;
      }
      const fp = dhcpFp.get(t.mac.toLowerCase());
      const attrs0 = (t.attributes && typeof t.attributes === "object" ? t.attributes : {}) as Record<string, unknown>;
      const context = buildEvidence({
        mac: t.mac,
        vendor: t.vendor,
        hostname: t.hostname,
        dhcpVendorClass: fp?.vendorClass ?? null,
        dhcpParamList: fp?.paramList ?? null,
        serviceHint: typeof attrs0.service_hint === "string" ? attrs0.service_hint : null,
        services: Array.isArray(attrs0.services) ? attrs0.services.map(String) : null,
        candidates: (t.sources as Candidate[]) ?? [],
      });
      let verdict: AdjudicatorVerdict | null = null;
      try {
        verdict = parseVerdict(await opts.callModel({ instructions: ADJUDICATOR_INSTRUCTIONS, context }));
      } catch {
        verdict = null;
      }
      if (!verdict) {
        res.failed++;
        continue;
      }
      const sources: Candidate[] = [
        ...((t.sources as Candidate[]) ?? []),
        {
          type: verdict.device_type,
          score: Math.min(AI_CONF_CEIL, verdict.confidence),
          signal: `ai:${verdict.cited_signals.join(",") || "—"}`,
          source: "ai",
        },
      ];
      resolved = { type: verdict.device_type, confidence: Math.min(AI_CONF_CEIL, verdict.confidence), sources };
      cache.set(hash, resolved);
      // Stash the model's model/os/rationale on the host attributes for the UI.
      const attrs = (t.attributes && typeof t.attributes === "object" ? t.attributes : {}) as Record<string, unknown>;
      attrs.classification = { model: verdict.model, os: verdict.os, rationale: verdict.rationale };
      await db
        .update(entitiesHost)
        .set({
          deviceType: resolved.type,
          classConfidence: resolved.confidence,
          classMethod: "ai",
          classSources: resolved.sources,
          attributes: attrs,
          updatedAt: new Date(),
        })
        .where(eq(entitiesHost.id, t.id));
      res.adjudicated++;
      continue;
    }

    // Cache hit — apply without spending a call.
    await db
      .update(entitiesHost)
      .set({
        deviceType: resolved.type,
        classConfidence: resolved.confidence,
        classMethod: "ai",
        classSources: resolved.sources,
        updatedAt: new Date(),
      })
      .where(eq(entitiesHost.id, t.id));
    res.cached++;
  }

  return res;
}

interface Fp {
  vendorClass?: string | null;
  paramList?: string | null;
}

async function buildDhcpFingerprints(): Promise<Map<string, Fp>> {
  const rows = await db
    .select({
      clientMac: dhcpObservations.clientMac,
      vendorClassId: dhcpObservations.vendorClassId,
      paramReqList: dhcpObservations.paramReqList,
    })
    .from(dhcpObservations);
  const fp = new Map<string, Fp>();
  for (const r of rows) {
    const mac = r.clientMac?.toLowerCase();
    if (!mac) continue;
    const cur = fp.get(mac) ?? {};
    if (!cur.vendorClass && r.vendorClassId) cur.vendorClass = r.vendorClassId;
    if (!cur.paramList && r.paramReqList) cur.paramList = r.paramReqList;
    fp.set(mac, cur);
  }
  return fp;
}
