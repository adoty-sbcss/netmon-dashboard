/**
 * Unified device inventory — the "accuracy-first" baseline that merges
 * auto-discovered entities (entities_host / entities_switch) with manually
 * registered devices (registry_devices), matched by normalized MAC then IP, and
 * overlays SNMP + reachability status from the latest reachability probe.
 *
 * This is the source of truth the network map is built from. A device that is
 * REACHABLE but NOT answering SNMP is flagged as an SNMP gap so an operator can
 * push a community string to the sensor and unlock it.
 */
import "server-only";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { entitiesHost, entitiesSwitch, registryDevices } from "@/db/schema";
import { listReachabilityForSchool } from "@/db/queries";
import { normalizeMac } from "@/lib/registry/types";

export type SnmpStatus = "responding" | "gap" | "na" | "unknown";

export interface InventoryRow {
  key: string;
  name: string;
  deviceType: string | null;
  vendor: string | null;
  model: string | null;
  ip: string | null;
  mac: string | null;
  source: "discovered" | "manual" | "both";
  isSwitch: boolean;
  registryId: number | null;
  hostId: number | null;
  switchId: number | null;
  building: string | null;
  room: string | null;
  status: string | null; // registry status when manual/linked
  lastSeen: Date | null;
  online: boolean | null;
  reachable: boolean | null;
  snmp: SnmpStatus;
}

export interface InventorySummary {
  total: number;
  online: number;
  snmpResponding: number;
  snmpGaps: number;
  discovered: number;
  manual: number;
  rows: InventoryRow[];
}

const ONLINE_WINDOW_MS = 25 * 60 * 60 * 1000; // ~last day of hourly scans

function recent(d: Date | null): boolean {
  return d != null && Date.now() - new Date(d).getTime() < ONLINE_WINDOW_MS;
}

function attrStr(attributes: unknown, key: string): string | null {
  if (attributes && typeof attributes === "object") {
    const v = (attributes as Record<string, unknown>)[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

export async function getInventoryForSchool(
  schoolId: number,
): Promise<InventorySummary> {
  const [switches, hosts, registry, reach] = await Promise.all([
    db.select().from(entitiesSwitch).where(eq(entitiesSwitch.schoolId, schoolId)),
    db.select().from(entitiesHost).where(eq(entitiesHost.schoolId, schoolId)),
    db
      .select()
      .from(registryDevices)
      .where(and(eq(registryDevices.schoolId, schoolId), eq(registryDevices.status, "active"))),
    listReachabilityForSchool(schoolId),
  ]);

  // SNMP / reachability overlay, keyed by IP (reachability only covers the
  // infrastructure candidate set, i.e. the gear where SNMP is expected).
  const reachByIp = new Map(reach.rows.filter((r) => r.ip).map((r) => [r.ip as string, r]));

  // Registry lookup for linking discovered → manual.
  const regByMac = new Map<string, typeof registry[number]>();
  const regByIp = new Map<string, typeof registry[number]>();
  for (const r of registry) {
    const m = normalizeMac(r.mac);
    if (m) regByMac.set(m, r);
    if (r.ip) regByIp.set(r.ip, r);
  }
  const usedRegistry = new Set<number>();

  const rows: InventoryRow[] = [];

  function reachabilityFor(ip: string | null) {
    if (!ip) return undefined;
    return reachByIp.get(ip);
  }

  function snmpStatus(opts: {
    ip: string | null;
    expected: boolean;
  }): { snmp: SnmpStatus; reachable: boolean | null } {
    const rr = reachabilityFor(opts.ip);
    if (rr) {
      const reachable = Boolean(rr.pingAlive) || rr.tracerouteHops != null;
      if (rr.snmpResponded) return { snmp: "responding", reachable };
      return { snmp: reachable ? "gap" : "unknown", reachable };
    }
    // No reachability probe for this IP — it wasn't an infra candidate.
    return { snmp: opts.expected ? "unknown" : "na", reachable: null };
  }

  function matchRegistry(mac: string | null, ip: string | null) {
    const m = normalizeMac(mac);
    if (m && regByMac.has(m)) return regByMac.get(m)!;
    if (ip && regByIp.has(ip)) return regByIp.get(ip)!;
    return null;
  }

  // --- Discovered switches ---------------------------------------------------
  for (const sw of switches) {
    const ip = sw.mgmtIp;
    const reg = matchRegistry(sw.chassisId, ip);
    if (reg) usedRegistry.add(reg.id);
    const { snmp, reachable } = snmpStatus({ ip, expected: true });
    const online = reachable ?? recent(sw.lastSeenAt);
    rows.push({
      key: `sw:${sw.id}`,
      name: reg?.name || sw.systemName || sw.mgmtIp || sw.chassisId,
      deviceType: "switch",
      vendor: reg?.vendor || attrStr(sw.attributes, "vendor"),
      model: reg?.model || attrStr(sw.attributes, "model"),
      ip,
      mac: sw.chassisId,
      source: reg ? "both" : "discovered",
      isSwitch: true,
      registryId: reg?.id ?? null,
      hostId: null,
      switchId: sw.id,
      building: reg?.building ?? null,
      room: reg?.room ?? null,
      status: reg?.status ?? null,
      lastSeen: sw.lastSeenAt,
      online,
      reachable,
      snmp,
    });
  }

  // --- Discovered hosts ------------------------------------------------------
  for (const h of hosts) {
    const reg = matchRegistry(h.mac, h.ip);
    if (reg) usedRegistry.add(reg.id);
    const dtype = reg?.deviceType || h.deviceType;
    const expected = ["switch", "router", "ap", "firewall"].includes(dtype ?? "");
    const { snmp, reachable } = snmpStatus({ ip: h.ip, expected });
    const online = reachable ?? recent(h.lastSeenAt);
    rows.push({
      key: `host:${h.id}`,
      name: reg?.name || h.hostname || h.ip || h.mac,
      deviceType: dtype ?? null,
      vendor: reg?.vendor || h.vendor,
      model: reg?.model || attrStr(h.attributes, "model"),
      ip: h.ip,
      mac: h.mac,
      source: reg ? "both" : "discovered",
      isSwitch: false,
      registryId: reg?.id ?? null,
      hostId: h.id,
      switchId: null,
      building: reg?.building ?? null,
      room: reg?.room ?? null,
      status: reg?.status ?? null,
      lastSeen: h.lastSeenAt,
      online,
      reachable,
      snmp,
    });
  }

  // --- Manual-only (registry rows that matched nothing discovered) -----------
  for (const r of registry) {
    if (usedRegistry.has(r.id)) continue;
    const expected = ["switch", "router", "ap", "firewall"].includes(r.deviceType);
    const { snmp, reachable } = snmpStatus({ ip: r.ip, expected });
    rows.push({
      key: `reg:${r.id}`,
      name: r.name,
      deviceType: r.deviceType === "other" ? r.deviceTypeOther : r.deviceType,
      vendor: r.vendor,
      model: r.model,
      ip: r.ip,
      mac: r.mac,
      source: "manual",
      isSwitch: r.deviceType === "switch",
      registryId: r.id,
      hostId: null,
      switchId: null,
      building: r.building,
      room: r.room,
      status: r.status,
      lastSeen: null,
      online: reachable,
      reachable,
      snmp,
    });
  }

  // Sort: SNMP gaps first (most actionable), then switches, then by name.
  const rank = (r: InventoryRow) => (r.snmp === "gap" ? 0 : r.isSwitch ? 1 : 2);
  rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  return {
    total: rows.length,
    online: rows.filter((r) => r.online).length,
    snmpResponding: rows.filter((r) => r.snmp === "responding").length,
    snmpGaps: rows.filter((r) => r.snmp === "gap").length,
    discovered: rows.filter((r) => r.source !== "manual").length,
    manual: rows.filter((r) => r.source === "manual").length,
    rows,
  };
}
