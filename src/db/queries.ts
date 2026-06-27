/**
 * Server-only data access for the dashboard UI. Each function returns
 * view-model-shaped data so server components stay thin. No auth filtering yet
 * (added with the auth milestone) — for now every scope is visible.
 *
 * Counts are computed with grouped aggregate queries and merged in JS rather
 * than correlated subqueries: simpler to read and the dataset is small.
 */
import "server-only";
import { cache } from "react";
import { and, count, desc, eq, exists, gte, ilike, inArray, isNotNull, isNull, lte, max, min, ne, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { db } from "./index";
import {
  districts,
  schools,
  sensors,
  users,
  grants,
} from "./schema/app";
import {
  scanRuns,
  devices,
  neighbors,
  dhcpObservations,
  dnsResolverHealth,
  dnsProbes,
  stpEvents,
  findings,
  snmpPolls,
  hostSwitchPorts,
  networkReachability,
} from "./schema/netmon";
import {
  entitiesHost,
  entitiesSwitch,
  healthRollupDaily,
  topologySnapshots,
  topologyPositions,
  snmpDeviceCredentials,
} from "./schema/entities";
import { issues } from "./schema/issues";
import {
  configBackups,
  desiredConfig,
  commandQueue,
  commandResults,
  sensorEnrollments,
} from "./schema/management";
import { enrichHost, type DeviceType } from "../lib/oui";
import {
  isCiscoIpPhoneName,
  isEndpointMapNode,
  isIpPhoneMapNode,
  looksLikeEndpoint,
  refineInfraType,
} from "../lib/classify/device-hints";
import type { SnmpInterface } from "../ingest/bundle";
import { collapseStacksAndLags } from "../lib/topology/graph";

// ---- shared shapes --------------------------------------------------------

export interface DistrictSummary {
  id: number;
  slug: string;
  name: string;
  isDemo: boolean;
  schoolCount: number;
  sensorCount: number;
  hostCount: number;
  switchCount: number;
  findingCount: number;
  lastScanAt: Date | null;
}

export interface SchoolSummary {
  id: number;
  slug: string;
  name: string | null;
  districtId: number;
  sensorCount: number;
  hostCount: number;
  switchCount: number;
  findingCount: number;
  lastScanAt: Date | null;
}

export interface NavTree {
  id: number;
  slug: string;
  name: string;
  isDemo: boolean;
  schools: { id: number; slug: string; name: string | null }[];
}

// ---- helpers --------------------------------------------------------------

function indexBy<T extends { key: number }>(rows: T[]): Map<number, T> {
  return new Map(rows.map((r) => [r.key, r]));
}

// ---- navigation -----------------------------------------------------------

/**
 * District → school tree for the sidebar. Pass `districtIds` to restrict to a
 * user's grants (undefined/null = unrestricted; [] = nothing).
 */
export async function getNavTree(
  opts: { districtIds?: number[] | null } = {},
): Promise<NavTree[]> {
  const restrict = opts.districtIds;
  if (Array.isArray(restrict) && restrict.length === 0) return [];
  const rows = await db
    .select({
      districtId: districts.id,
      districtSlug: districts.slug,
      districtName: districts.name,
      districtIsDemo: districts.isDemo,
      schoolId: schools.id,
      schoolSlug: schools.slug,
      schoolName: schools.name,
    })
    .from(districts)
    .leftJoin(schools, eq(schools.districtId, districts.id))
    .where(restrict ? inArray(districts.id, restrict) : undefined)
    .orderBy(districts.name, schools.name);

  const tree = new Map<number, NavTree>();
  for (const r of rows) {
    let node = tree.get(r.districtId);
    if (!node) {
      node = {
        id: r.districtId,
        slug: r.districtSlug,
        name: r.districtName,
        isDemo: r.districtIsDemo,
        schools: [],
      };
      tree.set(r.districtId, node);
    }
    if (r.schoolId != null) {
      node.schools.push({
        id: r.schoolId,
        slug: r.schoolSlug!,
        name: r.schoolName,
      });
    }
  }
  return [...tree.values()];
}

// ---- districts ------------------------------------------------------------

export async function listDistricts(
  opts: { districtIds?: number[] | null } = {},
): Promise<DistrictSummary[]> {
  const restrict = opts.districtIds;
  if (Array.isArray(restrict) && restrict.length === 0) return [];
  const districtWhere = restrict ? inArray(districts.id, restrict) : undefined;
  const [base, schoolCounts, sensorCounts, hostCounts, switchCounts, findingCounts, lastScans] =
    await Promise.all([
      db.select().from(districts).where(districtWhere).orderBy(districts.name),
      db
        .select({ key: schools.districtId, c: count() })
        .from(schools)
        .groupBy(schools.districtId),
      db
        .select({ key: schools.districtId, c: count() })
        .from(sensors)
        .innerJoin(schools, eq(sensors.schoolId, schools.id))
        .groupBy(schools.districtId),
      db
        .select({ key: entitiesHost.districtId, c: count() })
        .from(entitiesHost)
        .groupBy(entitiesHost.districtId),
      db
        .select({ key: entitiesSwitch.districtId, c: count() })
        .from(entitiesSwitch)
        .groupBy(entitiesSwitch.districtId),
      db
        .select({ key: schools.districtId, c: count() })
        .from(findings)
        .innerJoin(scanRuns, eq(findings.scanRunId, scanRuns.id))
        .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
        .innerJoin(schools, eq(sensors.schoolId, schools.id))
        .groupBy(schools.districtId),
      db
        .select({ key: schools.districtId, last: max(scanRuns.startedAt) })
        .from(scanRuns)
        .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
        .innerJoin(schools, eq(sensors.schoolId, schools.id))
        .groupBy(schools.districtId),
    ]);

  const sc = indexBy(schoolCounts.map((r) => ({ key: r.key, c: r.c })));
  const sn = indexBy(sensorCounts.map((r) => ({ key: r.key, c: r.c })));
  const hc = indexBy(hostCounts.map((r) => ({ key: r.key, c: r.c })));
  const wc = indexBy(switchCounts.map((r) => ({ key: r.key, c: r.c })));
  const fc = indexBy(findingCounts.map((r) => ({ key: r.key, c: r.c })));
  const ls = indexBy(lastScans.map((r) => ({ key: r.key, last: r.last })));

  return base.map((d) => ({
    id: d.id,
    slug: d.slug,
    name: d.name,
    isDemo: d.isDemo,
    schoolCount: sc.get(d.id)?.c ?? 0,
    sensorCount: sn.get(d.id)?.c ?? 0,
    hostCount: hc.get(d.id)?.c ?? 0,
    switchCount: wc.get(d.id)?.c ?? 0,
    findingCount: fc.get(d.id)?.c ?? 0,
    lastScanAt: ls.get(d.id)?.last ?? null,
  }));
}

export const getDistrictBySlug = cache(async (slug: string) => {
  const [row] = await db
    .select()
    .from(districts)
    .where(eq(districts.slug, slug))
    .limit(1);
  return row ?? null;
});

// ---- schools --------------------------------------------------------------

export async function listSchools(districtId: number): Promise<SchoolSummary[]> {
  const [base, sensorCounts, hostCounts, switchCounts, findingCounts, lastScans] =
    await Promise.all([
      db
        .select()
        .from(schools)
        .where(eq(schools.districtId, districtId))
        .orderBy(schools.name),
      db
        .select({ key: sensors.schoolId, c: count() })
        .from(sensors)
        .innerJoin(schools, eq(sensors.schoolId, schools.id))
        .where(eq(schools.districtId, districtId))
        .groupBy(sensors.schoolId),
      db
        .select({ key: entitiesHost.schoolId, c: count() })
        .from(entitiesHost)
        .where(eq(entitiesHost.districtId, districtId))
        .groupBy(entitiesHost.schoolId),
      db
        .select({ key: entitiesSwitch.schoolId, c: count() })
        .from(entitiesSwitch)
        .where(eq(entitiesSwitch.districtId, districtId))
        .groupBy(entitiesSwitch.schoolId),
      db
        .select({ key: sensors.schoolId, c: count() })
        .from(findings)
        .innerJoin(scanRuns, eq(findings.scanRunId, scanRuns.id))
        .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
        .innerJoin(schools, eq(sensors.schoolId, schools.id))
        .where(eq(schools.districtId, districtId))
        .groupBy(sensors.schoolId),
      db
        .select({ key: sensors.schoolId, last: max(scanRuns.startedAt) })
        .from(scanRuns)
        .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
        .innerJoin(schools, eq(sensors.schoolId, schools.id))
        .where(eq(schools.districtId, districtId))
        .groupBy(sensors.schoolId),
    ]);

  const sn = indexBy(sensorCounts.map((r) => ({ key: r.key, c: r.c })));
  const hc = indexBy(
    hostCounts.filter((r) => r.key != null).map((r) => ({ key: r.key!, c: r.c })),
  );
  const wc = indexBy(
    switchCounts.filter((r) => r.key != null).map((r) => ({ key: r.key!, c: r.c })),
  );
  const fc = indexBy(findingCounts.map((r) => ({ key: r.key, c: r.c })));
  const ls = indexBy(lastScans.map((r) => ({ key: r.key, last: r.last })));

  return base.map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    districtId: s.districtId,
    sensorCount: sn.get(s.id)?.c ?? 0,
    hostCount: hc.get(s.id)?.c ?? 0,
    switchCount: wc.get(s.id)?.c ?? 0,
    findingCount: fc.get(s.id)?.c ?? 0,
    lastScanAt: ls.get(s.id)?.last ?? null,
  }));
}

export const getSchoolBySlug = cache(async (districtId: number, slug: string) => {
  const [row] = await db
    .select()
    .from(schools)
    .where(and(eq(schools.districtId, districtId), eq(schools.slug, slug)))
    .limit(1);
  return row ?? null;
});

// ---- school detail --------------------------------------------------------

export interface SensorRow {
  id: number;
  slug: string;
  name: string | null;
  lastCheckinAt: Date | null;
  agentVersion: string | null;
  lastScanAt: Date | null;
  lastScanId: number | null;
  deviceCount: number;
}

export async function listSensorsForSchool(
  schoolId: number,
): Promise<SensorRow[]> {
  const sensorRows = await db
    .select()
    .from(sensors)
    .where(eq(sensors.schoolId, schoolId))
    .orderBy(sensors.slug);

  if (sensorRows.length === 0) return [];

  // Latest scan run per sensor (id + startedAt) in ONE query via DISTINCT ON,
  // tie-broken by the highest id. Replaces the previous per-sensor id lookup +
  // device-count query (2 extra round-trips PER sensor — an N+1 on the hot
  // school landing page).
  const latestRuns = await db
    .selectDistinctOn([scanRuns.sensorId], {
      sensorId: scanRuns.sensorId,
      scanId: scanRuns.id,
      lastScanAt: scanRuns.startedAt,
    })
    .from(scanRuns)
    .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
    .where(eq(sensors.schoolId, schoolId))
    .orderBy(scanRuns.sensorId, desc(scanRuns.startedAt), desc(scanRuns.id));

  const latestMap = new Map(latestRuns.map((r) => [r.sensorId!, r]));

  // Device counts for those latest scans in ONE grouped query.
  const scanIds = latestRuns.map((r) => r.scanId);
  const deviceCounts = scanIds.length
    ? await db
        .select({ scanId: devices.scanRunId, c: count() })
        .from(devices)
        .where(inArray(devices.scanRunId, scanIds))
        .groupBy(devices.scanRunId)
    : [];
  const dcMap = new Map(deviceCounts.map((r) => [r.scanId, r.c]));

  return sensorRows.map((s) => {
    const lr = latestMap.get(s.id);
    return {
      id: s.id,
      slug: s.slug,
      name: s.name,
      lastCheckinAt: s.lastCheckinAt,
      agentVersion: s.agentVersion,
      lastScanAt: lr?.lastScanAt ?? null,
      lastScanId: lr?.scanId ?? null,
      deviceCount: lr ? (dcMap.get(lr.scanId) ?? 0) : 0,
    };
  });
}

export interface SchoolStats {
  hostCount: number;
  switchCount: number;
  deviceCount: number;
  neighborCount: number;
  dhcpCount: number;
  dnsCount: number;
  findingCount: number;
  lastScanAt: Date | null;
  sensorCount: number;
}

/** Aggregate stats across the school's most-recent scan per sensor is heavy;
 * for now we sum over ALL scans in the school (small dataset) for activity totals,
 * and use canonical entity counts for the durable device picture. */
export async function getSchoolStats(schoolId: number): Promise<SchoolStats> {
  const scanIdsRows = await db
    .select({ id: scanRuns.id })
    .from(scanRuns)
    .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
    .where(eq(sensors.schoolId, schoolId));
  const scanIds = scanIdsRows.map((r) => r.id);

  const inScans = (col: AnyPgColumn) =>
    scanIds.length
      ? sql`${col} in (${sql.join(scanIds, sql`, `)})`
      : sql`false`;

  const [
    [host],
    [sw],
    [dev],
    [nb],
    [dhcp],
    [dns],
    [find],
    [last],
    [sen],
  ] = await Promise.all([
    db
      .select({ c: count() })
      .from(entitiesHost)
      .where(eq(entitiesHost.schoolId, schoolId)),
    db
      .select({ c: count() })
      .from(entitiesSwitch)
      .where(eq(entitiesSwitch.schoolId, schoolId)),
    db.select({ c: count() }).from(devices).where(inScans(devices.scanRunId)),
    db
      .select({ c: count() })
      .from(neighbors)
      .where(inScans(neighbors.scanRunId)),
    db
      .select({ c: count() })
      .from(dhcpObservations)
      .where(inScans(dhcpObservations.scanRunId)),
    db
      .select({ c: count() })
      .from(dnsProbes)
      .where(inScans(dnsProbes.scanRunId)),
    db.select({ c: count() }).from(findings).where(inScans(findings.scanRunId)),
    db
      .select({ last: max(scanRuns.startedAt) })
      .from(scanRuns)
      .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
      .where(eq(sensors.schoolId, schoolId)),
    db
      .select({ c: count() })
      .from(sensors)
      .where(eq(sensors.schoolId, schoolId)),
  ]);

  return {
    hostCount: host?.c ?? 0,
    switchCount: sw?.c ?? 0,
    deviceCount: dev?.c ?? 0,
    neighborCount: nb?.c ?? 0,
    dhcpCount: dhcp?.c ?? 0,
    dnsCount: dns?.c ?? 0,
    findingCount: find?.c ?? 0,
    lastScanAt: last?.last ?? null,
    sensorCount: sen?.c ?? 0,
  };
}

export interface FindingRow {
  id: number;
  rule: string;
  severity: string;
  title: string;
  detail: string | null;
  createdAt: Date | null;
}

export async function listFindingsForSchool(
  schoolId: number,
  limit = 50,
): Promise<FindingRow[]> {
  return db
    .select({
      id: findings.id,
      rule: findings.rule,
      severity: findings.severity,
      title: findings.title,
      detail: findings.detail,
      createdAt: findings.createdAt,
    })
    .from(findings)
    .innerJoin(scanRuns, eq(findings.scanRunId, scanRuns.id))
    .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
    .where(eq(sensors.schoolId, schoolId))
    .orderBy(desc(findings.createdAt))
    .limit(limit);
}

export interface HealthPoint {
  day: string;
  metrics: Record<string, number>;
}

export async function getSchoolHealthTrend(
  schoolId: number,
  days = 30,
): Promise<HealthPoint[]> {
  const rows = await db
    .select({ day: healthRollupDaily.day, metrics: healthRollupDaily.metrics })
    .from(healthRollupDaily)
    .where(eq(healthRollupDaily.schoolId, schoolId))
    .orderBy(desc(healthRollupDaily.day))
    .limit(days);
  return rows
    .reverse()
    .map((r) => ({ day: r.day, metrics: (r.metrics ?? {}) as Record<string, number> }));
}

// ---- scan snapshots (time travel) ----------------------------------------

export interface ScanSnapshot {
  scanId: number;
  sensorSlug: string;
  startedAt: Date | null;
}

/** Every scan run at a school (newest first) for the snapshot picker. */
export async function listScanSnapshotsForSchool(
  schoolId: number,
): Promise<ScanSnapshot[]> {
  const rows = await db
    .select({
      scanId: scanRuns.id,
      sensorSlug: sensors.slug,
      startedAt: scanRuns.startedAt,
    })
    .from(scanRuns)
    .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
    .where(eq(sensors.schoolId, schoolId))
    .orderBy(desc(scanRuns.startedAt));
  return rows;
}

/** Resolve a scan id to its sensor + time (for snapshot headers). */
export async function getScanSnapshot(
  schoolId: number,
  scanId: number,
): Promise<ScanSnapshot | null> {
  const [row] = await db
    .select({
      scanId: scanRuns.id,
      sensorSlug: sensors.slug,
      startedAt: scanRuns.startedAt,
    })
    .from(scanRuns)
    .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
    .where(and(eq(scanRuns.id, scanId), eq(sensors.schoolId, schoolId)))
    .limit(1);
  return row ?? null;
}

// ---- host inventory -------------------------------------------------------

export interface HostRow {
  /** Stable row key. */
  key: string;
  /** entities_host id for linking to detail (null if not deduped — MAC-less). */
  entityId: number | null;
  hostname: string | null;
  vendor: string | null;
  /** Coarse classification (printer/phone/computer/…); see src/lib/oui. */
  deviceType: DeviceType | null;
  mac: string | null;
  ip: string | null;
  /** Discovery method for snapshot rows (arp-scan/nmap/lldp); null for canonical. */
  source: string | null;
  /** Switch port the host's MAC was last learned on (ifName, e.g. "Gi1/0/12"). */
  switchPort: string | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
}

/** Latest resolved switch port per MAC for a school (most-recent scan wins). */
interface PortInfo {
  ifName: string | null;
  bridgePort: number | null;
  sourceDeviceIp: string | null;
}

async function latestPortsByMacForSchool(
  schoolId: number,
): Promise<Map<string, PortInfo>> {
  const rows = await db
    .select({
      mac: hostSwitchPorts.mac,
      ifName: hostSwitchPorts.ifName,
      bridgePort: hostSwitchPorts.bridgePort,
      sourceDeviceIp: hostSwitchPorts.sourceDeviceIp,
    })
    .from(hostSwitchPorts)
    .innerJoin(scanRuns, eq(hostSwitchPorts.scanRunId, scanRuns.id))
    .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
    .where(eq(sensors.schoolId, schoolId))
    .orderBy(desc(scanRuns.startedAt));
  const map = new Map<string, PortInfo>();
  for (const r of rows) {
    if (r.mac && !map.has(r.mac)) {
      map.set(r.mac, {
        ifName: r.ifName,
        bridgePort: r.bridgePort,
        sourceDeviceIp: r.sourceDeviceIp,
      });
    }
  }
  return map;
}

/** Human label for a resolved port: prefer ifName, else "port N". */
function portLabel(p: PortInfo | undefined): string | null {
  if (!p) return null;
  if (p.ifName) return p.ifName;
  if (p.bridgePort != null) return `port ${p.bridgePort}`;
  return null;
}

/**
 * Host inventory for a school. With no scanId → the canonical, deduped current
 * view (entities_host). With a scanId → exactly what that scan saw (devices),
 * including MAC-less nmap hits, linked back to a canonical entity when possible.
 */
export async function listHostsForSchool(
  schoolId: number,
  opts: { scanId?: number } = {},
): Promise<HostRow[]> {
  const portsByMac = await latestPortsByMacForSchool(schoolId);

  if (!opts.scanId) {
    const rows = await db
      .select()
      .from(entitiesHost)
      .where(eq(entitiesHost.schoolId, schoolId))
      .orderBy(entitiesHost.ip);
    return rows.map((h) => ({
      key: `e${h.id}`,
      entityId: h.id,
      hostname: h.hostname,
      vendor: h.vendor,
      deviceType: (h.deviceType as DeviceType | null) ?? null,
      mac: h.mac,
      ip: h.ip,
      source: null,
      switchPort: portLabel(h.mac ? portsByMac.get(h.mac) : undefined),
      firstSeenAt: h.firstSeenAt,
      lastSeenAt: h.lastSeenAt,
    }));
  }

  // Snapshot: devices from the chosen scan + mac→entity map for linking.
  const [deviceRows, macMap] = await Promise.all([
    db
      .select({
        id: devices.id,
        ip: devices.ip,
        mac: devices.mac,
        hostname: devices.hostname,
        vendor: devices.vendor,
        source: devices.source,
        firstSeenAt: devices.firstSeenAt,
        lastSeenAt: devices.lastSeenAt,
      })
      .from(devices)
      .where(eq(devices.scanRunId, opts.scanId))
      .orderBy(devices.ip),
    db
      .select({ id: entitiesHost.id, mac: entitiesHost.mac })
      .from(entitiesHost)
      .where(eq(entitiesHost.schoolId, schoolId)),
  ]);
  const macToEntity = new Map(macMap.map((m) => [m.mac, m.id]));

  return deviceRows.map((d) => {
    // Snapshot rows aren't enriched at rest — derive vendor/type on the fly so
    // the per-scan view matches the canonical view.
    const { vendor, deviceType } = enrichHost({
      mac: d.mac,
      vendor: d.vendor,
      hostname: d.hostname,
    });
    return {
      key: `d${d.id}`,
      entityId: d.mac ? (macToEntity.get(d.mac) ?? null) : null,
      hostname: d.hostname,
      vendor,
      deviceType,
      mac: d.mac,
      ip: d.ip,
      source: d.source,
      switchPort: portLabel(d.mac ? portsByMac.get(d.mac) : undefined),
      firstSeenAt: d.firstSeenAt,
      lastSeenAt: d.lastSeenAt,
    };
  });
}

// ---- host detail ----------------------------------------------------------

export interface HostSighting {
  scanId: number;
  startedAt: Date | null;
  sensorSlug: string;
  ip: string | null;
  hostname: string | null;
  vendor: string | null;
  source: string | null;
  /** PROV-5 Phase 3: the VLAN this sighting was on (null = untagged/uplink). Surfaces
   *  a device seen on multiple VLANs (the same MAC dedups to one entity). */
  vlanId: number | null;
}

export interface SnmpAttr {
  oidName: string | null;
  value: string | null;
  deviceIp: string | null;
}

/** A single switch port: its ifIndex plus the CORE-2/INV per-port health record. */
export type SwitchPort = { ifIndex: string } & SnmpInterface;

/** A device the bridge FDB shows directly attached to a switch/router port. The
 *  MAC is matched to the canonical inventory (host OR switch) so the row carries
 *  an IP, reverse-DNS hostname, device type, and a click-through link. */
export interface ConnectedDevice {
  ifName: string | null;
  mac: string;
  /** Canonical entity this MAC resolved to (null = not in inventory). */
  entityId: number | null;
  entityKind: "host" | "switch" | null;
  hostname: string | null;
  ip: string | null;
  deviceType: DeviceType | null;
}

/** DHCP fingerprint for an endpoint that may never speak SNMP. */
export interface DhcpFingerprint {
  vendorClassId: string | null;
  clientHostname: string | null;
  paramReqList: string | null;
  seenAt: Date | null;
}

/** An open issue that mentions this device (heuristic text match). */
export interface DeviceIssue {
  id: number;
  title: string;
  severity: string;
  status: string;
  recommendation: string | null;
}

/** The read community the sensor found working for this device (from the bundle). */
export interface DeviceSnmpCredential {
  community: string | null;
  version: string | null;
  lastSucceededAt: Date | null;
  failureCount: number | null;
}

export interface HostDetail {
  id: number;
  districtId: number;
  mac: string;
  ip: string | null;
  hostname: string | null;
  vendor: string | null;
  /** Effective type: manual override > SNMP-refined > stored auto. */
  deviceType: DeviceType | null;
  /** Operator's manual classification, if set (drives the "manual vs auto" UI). */
  deviceTypeOverride: DeviceType | null;
  /** Auto-detected type (shown as a hint, and what "reset to auto" reverts to). */
  deviceTypeAuto: DeviceType | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  attributes: Record<string, unknown>;
  model: string | null;
  serial: string | null;
  /** Resolved switch port (ifName / "port N"); null until a switch FDB resolves it. */
  switchPort: string | null;
  /** IP of the switch/gateway whose forwarding table produced the port mapping. */
  switchPortSource: string | null;
  /** Canonical switch entity for switchPortSource (clickable), when known. */
  switchEntityId: number | null;
  /** That switch's system name (so the host shows a name, not just an IP). */
  switchName: string | null;
  /** Latest SNMP-reachability for this IP (powers the SNMP card). */
  snmpResponded: boolean | null;
  snmpVersion: string | null;
  snmpCheckedAt: Date | null;
  /** The read community the sensor found working for this device, if any. */
  snmpCredential: DeviceSnmpCredential | null;
  dhcp: DhcpFingerprint | null;
  /** Set when this host is itself infra (gateway/router/switch) we SNMP-crawled. */
  ports: SwitchPort[];
  connectedDevices: ConnectedDevice[];
  sightings: HostSighting[];
  snmp: SnmpAttr[];
}

export async function getHostDetail(
  schoolId: number,
  entityId: number,
): Promise<HostDetail | null> {
  const [host] = await db
    .select()
    .from(entitiesHost)
    .where(
      and(eq(entitiesHost.id, entityId), eq(entitiesHost.schoolId, schoolId)),
    )
    .limit(1);
  if (!host) return null;

  const [sightings, snmp, portRows] = await Promise.all([
    db
      .select({
        scanId: scanRuns.id,
        startedAt: scanRuns.startedAt,
        sensorSlug: sensors.slug,
        ip: devices.ip,
        hostname: devices.hostname,
        vendor: devices.vendor,
        source: devices.source,
        vlanId: scanRuns.vlanId,
      })
      .from(devices)
      .innerJoin(scanRuns, eq(devices.scanRunId, scanRuns.id))
      .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
      .where(and(eq(sensors.schoolId, schoolId), eq(devices.mac, host.mac)))
      .orderBy(desc(scanRuns.startedAt))
      .limit(200),
    host.ip
      ? db
          .select({
            oidName: snmpPolls.oidName,
            value: snmpPolls.value,
            deviceIp: snmpPolls.deviceIp,
          })
          .from(snmpPolls)
          .innerJoin(scanRuns, eq(snmpPolls.scanRunId, scanRuns.id))
          .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
          .where(
            and(
              eq(sensors.schoolId, schoolId),
              eq(snmpPolls.deviceIp, host.ip),
              sql`${snmpPolls.oidName} <> 'ifTable'`,
            ),
          )
          .limit(40)
      : Promise.resolve([] as SnmpAttr[]),
    db
      .select({
        ifName: hostSwitchPorts.ifName,
        bridgePort: hostSwitchPorts.bridgePort,
        sourceDeviceIp: hostSwitchPorts.sourceDeviceIp,
      })
      .from(hostSwitchPorts)
      .innerJoin(scanRuns, eq(hostSwitchPorts.scanRunId, scanRuns.id))
      .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
      .where(
        and(eq(sensors.schoolId, schoolId), eq(hostSwitchPorts.mac, host.mac)),
      )
      .orderBy(desc(scanRuns.startedAt))
      .limit(1),
  ]);

  const port = portRows[0];

  // Refine the stored type with SNMP sysDescr when this host was SNMP-polled.
  const sysDescr =
    snmp.find((a) => a.oidName === "sysDescr" || a.oidName === "sysName")?.value ??
    null;
  const { vendor, deviceType } = enrichHost({
    mac: host.mac,
    vendor: host.vendor,
    hostname: host.hostname,
    snmpSysDescr: sysDescr,
  });
  // Manual override is human truth — it wins over the (re)derived auto type.
  const overrideType = (host.deviceTypeOverride as DeviceType | null) || null;
  const autoType = deviceType ?? (host.deviceType as DeviceType | null) ?? null;
  const effectiveType = overrideType ?? autoType;

  const model =
    mapAttrStr(host.attributes, "model") ??
    snmp.find((a) => a.oidName === "entPhysicalModelName")?.value ??
    null;
  const serial =
    mapAttrStr(host.attributes, "serial") ??
    snmp.find((a) => a.oidName === "entPhysicalSerialNum")?.value ??
    null;

  // Only an infrastructure host (gateway/router/switch) carries its own ports +
  // FDB-attached devices — skip the (school-wide) FDB scan for ordinary endpoints.
  const isInfra = ["switch", "router", "ap", "firewall"].includes(effectiveType ?? "");

  const [dhcpRow, reachRow, switchEnt, credRow] = await Promise.all([
    db
      .select({
        vendorClassId: dhcpObservations.vendorClassId,
        clientHostname: dhcpObservations.clientHostname,
        paramReqList: dhcpObservations.paramReqList,
        seenAt: dhcpObservations.seenAt,
      })
      .from(dhcpObservations)
      .innerJoin(scanRuns, eq(dhcpObservations.scanRunId, scanRuns.id))
      .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
      .where(
        and(
          eq(sensors.schoolId, schoolId),
          eq(dhcpObservations.clientMac, host.mac),
          or(
            isNotNull(dhcpObservations.vendorClassId),
            isNotNull(dhcpObservations.clientHostname),
            isNotNull(dhcpObservations.paramReqList),
          ),
        ),
      )
      .orderBy(desc(dhcpObservations.seenAt))
      .limit(1),
    host.ip
      ? db
          .select({
            snmpResponded: networkReachability.snmpResponded,
            snmpVersion: networkReachability.snmpVersion,
            checkedAt: networkReachability.checkedAt,
          })
          .from(networkReachability)
          .innerJoin(scanRuns, eq(networkReachability.scanRunId, scanRuns.id))
          .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
          .where(and(eq(sensors.schoolId, schoolId), eq(networkReachability.ip, host.ip)))
          .orderBy(desc(networkReachability.checkedAt))
          .limit(1)
      : Promise.resolve(
          [] as { snmpResponded: boolean | null; snmpVersion: string | null; checkedAt: Date | null }[],
        ),
    port?.sourceDeviceIp
      ? db
          .select({ id: entitiesSwitch.id, systemName: entitiesSwitch.systemName })
          .from(entitiesSwitch)
          .where(
            and(
              eq(entitiesSwitch.schoolId, schoolId),
              eq(entitiesSwitch.mgmtIp, port.sourceDeviceIp),
            ),
          )
          .limit(1)
      : Promise.resolve([] as { id: number; systemName: string | null }[]),
    host.ip
      ? db
          .select({
            community: snmpDeviceCredentials.community,
            version: snmpDeviceCredentials.version,
            lastSucceededAt: snmpDeviceCredentials.lastSucceededAt,
            failureCount: snmpDeviceCredentials.failureCount,
          })
          .from(snmpDeviceCredentials)
          .where(
            and(
              eq(snmpDeviceCredentials.schoolId, schoolId),
              eq(snmpDeviceCredentials.deviceIp, host.ip),
            ),
          )
          .limit(1)
      : Promise.resolve([] as DeviceSnmpCredential[]),
  ]);

  const [ports, connectedDevices] =
    isInfra && host.ip
      ? await Promise.all([
          getDevicePorts(schoolId, { mgmtIp: host.ip }),
          getConnectedDevices(schoolId, host.ip),
        ])
      : [[] as SwitchPort[], [] as ConnectedDevice[]];

  return {
    id: host.id,
    districtId: host.districtId,
    mac: host.mac,
    ip: host.ip,
    hostname: host.hostname,
    vendor: vendor ?? host.vendor,
    deviceType: effectiveType,
    deviceTypeOverride: overrideType,
    deviceTypeAuto: autoType,
    firstSeenAt: host.firstSeenAt,
    lastSeenAt: host.lastSeenAt,
    attributes: (host.attributes ?? {}) as Record<string, unknown>,
    model,
    serial,
    switchPort: portLabel(port),
    switchPortSource: port?.sourceDeviceIp ?? null,
    switchEntityId: switchEnt[0]?.id ?? null,
    switchName: switchEnt[0]?.systemName ?? null,
    snmpResponded: reachRow[0]?.snmpResponded ?? null,
    snmpVersion: reachRow[0]?.snmpVersion ?? null,
    snmpCheckedAt: reachRow[0]?.checkedAt ?? null,
    snmpCredential: credRow[0] ?? null,
    dhcp: dhcpRow[0] ?? null,
    ports,
    connectedDevices,
    sightings,
    snmp,
  };
}

// ---- switches -------------------------------------------------------------

export interface SwitchRow {
  id: number;
  chassisId: string;
  systemName: string | null;
  systemDescription: string | null;
  mgmtIp: string | null;
  capabilities: string[] | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
}

export async function listSwitchesForSchool(
  schoolId: number,
): Promise<SwitchRow[]> {
  const rows = await db
    .select({
      id: entitiesSwitch.id,
      chassisId: entitiesSwitch.chassisId,
      systemName: entitiesSwitch.systemName,
      systemDescription: entitiesSwitch.systemDescription,
      mgmtIp: entitiesSwitch.mgmtIp,
      capabilities: entitiesSwitch.capabilities,
      firstSeenAt: entitiesSwitch.firstSeenAt,
      lastSeenAt: entitiesSwitch.lastSeenAt,
    })
    .from(entitiesSwitch)
    .where(eq(entitiesSwitch.schoolId, schoolId))
    .orderBy(entitiesSwitch.systemName);
  // Printers / UPSes / cameras / Cisco IP phones answer SNMP and get swept into the
  // fabric crawl — they aren't switches, so drop them from the switch list (they show
  // as endpoints instead).
  return rows.filter(
    (r) =>
      !looksLikeEndpoint(r.systemDescription) &&
      !isCiscoIpPhoneName(r.systemName) &&
      !isCiscoIpPhoneName(r.chassisId),
  );
}

// ---- network-device reachability (ping + SNMP-response + traceroute) ------

export interface TracerouteHop {
  hop: number;
  ip: string | null;
  rtt_ms: number | null;
}

export interface ReachabilityRow {
  id: number;
  ip: string | null;
  hostname: string | null;
  vendor: string | null;
  source: string | null; // gateway | lldp | oui
  pingAlive: boolean | null;
  pingRttMs: number | null;
  pingLossPct: number | null;
  snmpResponded: boolean | null;
  snmpVersion: string | null;
  tracerouteHops: number | null;
  traceroutePath: TracerouteHop[];
  checkedAt: Date | null;
  sensorSlug: string;
  /** Canonical entity this probe's IP resolves to (for click-through), if any. */
  entityKind: "host" | "switch" | null;
  entityId: number | null;
}

export interface ReachabilitySummary {
  scanAt: Date | null;
  total: number;
  /** Answered SNMP (fully usable for topology). */
  snmpOk: number;
  /** Reachable (ping OR traceroute) but NOT answering SNMP — the gap to fix. */
  reachableNoSnmp: number;
  /** No ping AND traceroute never arrived — genuinely unreachable. */
  unreachable: number;
  rows: ReachabilityRow[];
}

/** A device is "reachable" if it pings OR traceroute reached it (many managed
 * switches drop ICMP echo but still answer traceroute's probe). */
function isReachable(r: { pingAlive: boolean | null; tracerouteHops: number | null }): boolean {
  return Boolean(r.pingAlive) || r.tracerouteHops != null;
}

/**
 * Network-device reachability for a school: ping + SNMP-response + traceroute for
 * each infrastructure candidate (gateway / LLDP mgmt IPs / network-vendor OUIs).
 * Uses the latest scan PER SENSOR so a multi-IDF school shows each sensor's local
 * view. Answers "which switches are out there, and which answer SNMP vs only ping?"
 */
export const listReachabilityForSchool = cache(async (
  schoolId: number,
): Promise<ReachabilitySummary> => {
  // Latest scan per sensor that produced reachability rows.
  const seen = await db
    .select({
      scanId: networkReachability.scanRunId,
      sensorId: scanRuns.sensorId,
      startedAt: scanRuns.startedAt,
    })
    .from(networkReachability)
    .innerJoin(scanRuns, eq(networkReachability.scanRunId, scanRuns.id))
    .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
    .where(eq(sensors.schoolId, schoolId))
    .orderBy(desc(scanRuns.startedAt));

  const latestBySensor = new Map<number, number>();
  let scanAt: Date | null = null;
  for (const r of seen) {
    if (scanAt === null) scanAt = r.startedAt;
    if (r.sensorId != null && !latestBySensor.has(r.sensorId)) {
      latestBySensor.set(r.sensorId, r.scanId);
    }
  }
  const scanIds = [...latestBySensor.values()];
  if (scanIds.length === 0) {
    return { scanAt: null, total: 0, snmpOk: 0, reachableNoSnmp: 0, unreachable: 0, rows: [] };
  }

  const raw = await db
    .select({
      id: networkReachability.id,
      ip: networkReachability.ip,
      hostname: networkReachability.hostname,
      vendor: networkReachability.vendor,
      source: networkReachability.source,
      pingAlive: networkReachability.pingAlive,
      pingRttMs: networkReachability.pingRttMs,
      pingLossPct: networkReachability.pingLossPct,
      snmpResponded: networkReachability.snmpResponded,
      snmpVersion: networkReachability.snmpVersion,
      tracerouteHops: networkReachability.tracerouteHops,
      traceroutePath: networkReachability.traceroutePath,
      checkedAt: networkReachability.checkedAt,
      sensorSlug: sensors.slug,
    })
    .from(networkReachability)
    .innerJoin(scanRuns, eq(networkReachability.scanRunId, scanRuns.id))
    .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
    .where(inArray(networkReachability.scanRunId, scanIds))
    .orderBy(desc(networkReachability.snmpResponded), networkReachability.ip);

  const index = await getSchoolDeviceIndex(schoolId);
  const rows: ReachabilityRow[] = raw.map((r) => {
    const ref = r.ip ? index.byIp.get(r.ip) : undefined;
    return {
      ...r,
      traceroutePath: Array.isArray(r.traceroutePath)
        ? (r.traceroutePath as TracerouteHop[])
        : [],
      entityKind: ref?.entityKind ?? null,
      entityId: ref?.entityId ?? null,
    };
  });

  return {
    scanAt,
    total: rows.length,
    snmpOk: rows.filter((r) => r.snmpResponded).length,
    reachableNoSnmp: rows.filter((r) => !r.snmpResponded && isReachable(r)).length,
    unreachable: rows.filter((r) => !isReachable(r)).length,
    rows,
  };
});

export interface SwitchAppearance {
  scanId: number;
  startedAt: Date | null;
  sensorSlug: string;
  localPort: string | null;
  portId: string | null;
  portDescription: string | null;
  vlanId: number | null;
  protocol: string | null;
}

export interface SwitchDetail extends SwitchRow {
  districtId: number;
  attributes: Record<string, unknown>;
  appearances: SwitchAppearance[];
  snmp: SnmpAttr[];
  interfaceCount: number;
  /** Per-port detail from the stored physical snapshot (CORE-2/INV). */
  ports: SwitchPort[];
  /** Devices the bridge FDB shows directly attached to this switch. */
  connectedDevices: ConnectedDevice[];
  snmpResponded: boolean | null;
  snmpVersion: string | null;
  snmpCheckedAt: Date | null;
  /** The read community the sensor found working for this switch, if any. */
  snmpCredential: DeviceSnmpCredential | null;
}

export async function getSwitchDetail(
  schoolId: number,
  switchId: number,
): Promise<SwitchDetail | null> {
  const [sw] = await db
    .select()
    .from(entitiesSwitch)
    .where(
      and(eq(entitiesSwitch.id, switchId), eq(entitiesSwitch.schoolId, schoolId)),
    )
    .limit(1);
  if (!sw) return null;

  const appearances = await db
    .select({
      scanId: scanRuns.id,
      startedAt: scanRuns.startedAt,
      sensorSlug: sensors.slug,
      localPort: neighbors.localPort,
      portId: neighbors.portId,
      portDescription: neighbors.portDescription,
      vlanId: neighbors.vlanId,
      protocol: neighbors.protocol,
    })
    .from(neighbors)
    .innerJoin(scanRuns, eq(neighbors.scanRunId, scanRuns.id))
    .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
    .where(
      and(eq(sensors.schoolId, schoolId), eq(neighbors.chassisId, sw.chassisId)),
    )
    .orderBy(desc(scanRuns.startedAt))
    .limit(200);

  // Identity attributes (sys*, ifName, …); the bulk ifTable rows are excluded.
  // The interface COUNT comes from `ports.length` below, NOT a count() over
  // snmp_polls: ifTable is an UNCAPPED bulk OID (one row per interface per scan),
  // so for a big stacked switch that count traversed MILLIONS of rows (× a
  // scan_runs→sensors join) — the ~60s switch-detail bottleneck. ports.length is
  // the live interface count and matches what the ports table renders.
  let snmp: SnmpAttr[] = [];
  if (sw.mgmtIp) {
    snmp = await db
      .select({
        oidName: snmpPolls.oidName,
        value: snmpPolls.value,
        deviceIp: snmpPolls.deviceIp,
      })
      .from(snmpPolls)
      .innerJoin(scanRuns, eq(snmpPolls.scanRunId, scanRuns.id))
      .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
      .where(
        and(
          eq(sensors.schoolId, schoolId),
          eq(snmpPolls.deviceIp, sw.mgmtIp),
          sql`${snmpPolls.oidName} <> 'ifTable'`,
        ),
      )
      .limit(40);
  }

  const [ports, connectedDevices, reachRow, credRow] = await Promise.all([
    getDevicePorts(schoolId, { chassisId: sw.chassisId, mgmtIp: sw.mgmtIp }),
    sw.mgmtIp ? getConnectedDevices(schoolId, sw.mgmtIp) : Promise.resolve([] as ConnectedDevice[]),
    sw.mgmtIp
      ? db
          .select({
            snmpResponded: networkReachability.snmpResponded,
            snmpVersion: networkReachability.snmpVersion,
            checkedAt: networkReachability.checkedAt,
          })
          .from(networkReachability)
          .innerJoin(scanRuns, eq(networkReachability.scanRunId, scanRuns.id))
          .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
          .where(and(eq(sensors.schoolId, schoolId), eq(networkReachability.ip, sw.mgmtIp)))
          .orderBy(desc(networkReachability.checkedAt))
          .limit(1)
      : Promise.resolve(
          [] as { snmpResponded: boolean | null; snmpVersion: string | null; checkedAt: Date | null }[],
        ),
    sw.mgmtIp
      ? db
          .select({
            community: snmpDeviceCredentials.community,
            version: snmpDeviceCredentials.version,
            lastSucceededAt: snmpDeviceCredentials.lastSucceededAt,
            failureCount: snmpDeviceCredentials.failureCount,
          })
          .from(snmpDeviceCredentials)
          .where(
            and(
              eq(snmpDeviceCredentials.schoolId, schoolId),
              eq(snmpDeviceCredentials.deviceIp, sw.mgmtIp),
            ),
          )
          .limit(1)
      : Promise.resolve([] as DeviceSnmpCredential[]),
  ]);

  return {
    id: sw.id,
    districtId: sw.districtId,
    chassisId: sw.chassisId,
    systemName: sw.systemName,
    systemDescription: sw.systemDescription,
    mgmtIp: sw.mgmtIp,
    capabilities: sw.capabilities,
    firstSeenAt: sw.firstSeenAt,
    lastSeenAt: sw.lastSeenAt,
    attributes: (sw.attributes ?? {}) as Record<string, unknown>,
    appearances,
    snmp,
    interfaceCount: ports.length,
    ports,
    connectedDevices,
    snmpResponded: reachRow[0]?.snmpResponded ?? null,
    snmpVersion: reachRow[0]?.snmpVersion ?? null,
    snmpCheckedAt: reachRow[0]?.checkedAt ?? null,
    snmpCredential: credRow[0] ?? null,
  };
}

// ---- device ports + connected devices + per-device issues -----------------

/**
 * Per-port interface health for a crawled switch/router, read from the school's
 * stored physical snapshot node (CORE-2/INV `interfaces`), matched by chassis or
 * mgmt IP. Sorted by numeric ifIndex. Empty when the device hasn't been
 * SNMP-crawled (so endpoints + un-polled gear render nothing).
 */
export async function getDevicePorts(
  schoolId: number,
  match: { chassisId?: string | null; mgmtIp?: string | null },
): Promise<SwitchPort[]> {
  const [row] = await db
    .select({ graph: topologySnapshots.graph })
    .from(topologySnapshots)
    .where(
      and(
        eq(topologySnapshots.scopeType, "school"),
        eq(topologySnapshots.scopeId, schoolId),
        eq(topologySnapshots.kind, "physical"),
      ),
    )
    .limit(1);
  if (!row) return [];
  const nodes =
    ((row.graph ?? {}) as {
      nodes?: Array<{
        id?: string;
        mgmt_ip?: string | null;
        interfaces?: Record<string, SnmpInterface> | null;
      }>;
    }).nodes ?? [];
  const wantId = match.chassisId ? `switch:${match.chassisId}` : null;
  const node = nodes.find(
    (n) =>
      (wantId != null && n.id === wantId) ||
      (match.mgmtIp != null && n.mgmt_ip === match.mgmtIp),
  );
  const ifaces = node?.interfaces ?? null;
  if (!ifaces) return [];
  return Object.entries(ifaces)
    .map(([ifIndex, rec]) => ({ ifIndex, ...rec }))
    .sort((a, b) => Number(a.ifIndex) - Number(b.ifIndex));
}

/**
 * Devices the bridge FDB shows DIRECTLY attached to a switch/router (by mgmt IP).
 * Reuses getFdbAttachments' access-port disambiguation (a device is attributed to
 * the port carrying the fewest MACs) so uplink ports — which learn every
 * downstream MAC — don't flood the list. Each row links to the host's page.
 */
export async function getConnectedDevices(
  schoolId: number,
  deviceIp: string,
): Promise<ConnectedDevice[]> {
  const attachments = await getFdbAttachments(schoolId);
  const here = [...attachments.entries()].filter(([, v]) => v.switchIp === deviceIp);
  if (here.length === 0) return [];
  // Match each learned MAC to the canonical inventory — a host first, else a
  // switch (chassis_id IS the switch's base MAC) — so the row gets IP / reverse
  // DNS / type / a click-through, matching the rest of the inventory.
  const [hostRows, switchRows] = await Promise.all([
    db
      .select({
        id: entitiesHost.id,
        mac: entitiesHost.mac,
        hostname: entitiesHost.hostname,
        ip: entitiesHost.ip,
        deviceType: entitiesHost.deviceType,
        deviceTypeOverride: entitiesHost.deviceTypeOverride,
        excludedAt: entitiesHost.excludedAt,
      })
      .from(entitiesHost)
      .where(eq(entitiesHost.schoolId, schoolId)),
    db
      .select({
        id: entitiesSwitch.id,
        chassisId: entitiesSwitch.chassisId,
        systemName: entitiesSwitch.systemName,
        mgmtIp: entitiesSwitch.mgmtIp,
        excludedAt: entitiesSwitch.excludedAt,
      })
      .from(entitiesSwitch)
      .where(eq(entitiesSwitch.schoolId, schoolId)),
  ]);
  const hostByMac = new Map(hostRows.map((h) => [h.mac.toLowerCase(), h]));
  const switchByMac = new Map(switchRows.map((s) => [s.chassisId.toLowerCase(), s]));
  const out: ConnectedDevice[] = [];
  for (const [mac, v] of here) {
    const h = hostByMac.get(mac);
    if (h) {
      if (h.excludedAt) continue; // hidden / purged from inventory
      out.push({
        ifName: v.port,
        mac,
        entityId: h.id,
        entityKind: "host",
        hostname: h.hostname ?? null,
        ip: h.ip ?? null,
        deviceType:
          ((h.deviceTypeOverride as DeviceType | null) ||
            (h.deviceType as DeviceType | null)) ??
          null,
      });
      continue;
    }
    const s = switchByMac.get(mac);
    if (s) {
      if (s.excludedAt) continue;
      out.push({
        ifName: v.port,
        mac,
        entityId: s.id,
        entityKind: "switch",
        hostname: s.systemName ?? null,
        ip: s.mgmtIp ?? null,
        deviceType: "switch" as DeviceType,
      });
      continue;
    }
    // Learned MAC we don't have an entity for — still show it (no link).
    out.push({
      ifName: v.port,
      mac,
      entityId: null,
      entityKind: null,
      hostname: null,
      ip: null,
      deviceType: null,
    });
  }
  out.sort(
    (a, b) =>
      (a.ifName ?? "").localeCompare(b.ifName ?? "", undefined, { numeric: true }) ||
      (a.ip ?? "").localeCompare(b.ip ?? ""),
  );
  return out;
}

/**
 * Open issues that mention this device by ip / mac / hostname. Heuristic text
 * match — `issues` carries no device FK, so we ILIKE the title/detail; may
 * over/under-match (v1). District-wide + this school's scope, excluding resolved.
 */
export async function getDeviceIssues(
  districtId: number,
  schoolId: number,
  ref: { ip?: string | null; mac?: string | null; hostname?: string | null },
): Promise<DeviceIssue[]> {
  const terms = [ref.ip, ref.mac, ref.hostname]
    .map((t) => (t ?? "").trim())
    .filter((t) => t.length >= 3);
  if (terms.length === 0) return [];
  const likeClauses = terms.flatMap((t) => [
    ilike(issues.title, `%${t}%`),
    ilike(issues.detail, `%${t}%`),
  ]);
  return db
    .select({
      id: issues.id,
      title: issues.title,
      severity: issues.severity,
      status: issues.status,
      recommendation: issues.recommendation,
    })
    .from(issues)
    .where(
      and(
        eq(issues.districtId, districtId),
        ne(issues.status, "resolved"),
        or(
          eq(issues.scopeType, "district"),
          and(eq(issues.scopeType, "school"), eq(issues.scopeId, schoolId)),
        ),
        or(...likeClauses),
      ),
    )
    .orderBy(desc(issues.lastSeenAt))
    .limit(20);
}

/** A canonical entity a raw IP/MAC resolved to, for cross-linking tables. */
export interface DeviceRef {
  entityKind: "host" | "switch";
  entityId: number;
}

/**
 * Build IP→entity and MAC→entity lookups for a school so any table that only has
 * a raw IP/MAC (reachability probes, LLDP neighbors, …) can link to the device's
 * detail page. Excludes purged devices. Host wins on a shared IP (a switch only
 * fills an IP no host claimed); chassis_id (switch base MAC) populates byMac too.
 */
export const getSchoolDeviceIndex = cache(async (
  schoolId: number,
): Promise<{ byIp: Map<string, DeviceRef>; byMac: Map<string, DeviceRef> }> => {
  const [hosts, switches] = await Promise.all([
    db
      .select({ id: entitiesHost.id, ip: entitiesHost.ip, mac: entitiesHost.mac })
      .from(entitiesHost)
      .where(and(eq(entitiesHost.schoolId, schoolId), isNull(entitiesHost.excludedAt))),
    db
      .select({ id: entitiesSwitch.id, mgmtIp: entitiesSwitch.mgmtIp, chassisId: entitiesSwitch.chassisId })
      .from(entitiesSwitch)
      .where(and(eq(entitiesSwitch.schoolId, schoolId), isNull(entitiesSwitch.excludedAt))),
  ]);
  const byIp = new Map<string, DeviceRef>();
  const byMac = new Map<string, DeviceRef>();
  for (const h of hosts) {
    if (h.ip) byIp.set(h.ip, { entityKind: "host", entityId: h.id });
    if (h.mac) byMac.set(h.mac.toLowerCase(), { entityKind: "host", entityId: h.id });
  }
  for (const s of switches) {
    if (s.mgmtIp && !byIp.has(s.mgmtIp)) byIp.set(s.mgmtIp, { entityKind: "switch", entityId: s.id });
    if (s.chassisId) byMac.set(s.chassisId.toLowerCase(), { entityKind: "switch", entityId: s.id });
  }
  return { byIp, byMac };
});

// ---- DHCP -----------------------------------------------------------------

export interface DhcpRow {
  id: number;
  messageType: string | null;
  serverIp: string | null;
  serverMac: string | null;
  clientMac: string | null;
  offeredIp: string | null;
  subnetMask: string | null;
  router: string | null;
  dnsServers: string | null;
  seenAt: Date | null;
  sensorSlug: string;
}

export async function listDhcpForSchool(
  schoolId: number,
  opts: { scanId?: number } = {},
): Promise<DhcpRow[]> {
  const where = opts.scanId
    ? and(eq(sensors.schoolId, schoolId), eq(dhcpObservations.scanRunId, opts.scanId))
    : eq(sensors.schoolId, schoolId);
  return db
    .select({
      id: dhcpObservations.id,
      messageType: dhcpObservations.messageType,
      serverIp: dhcpObservations.serverIp,
      serverMac: dhcpObservations.serverMac,
      clientMac: dhcpObservations.clientMac,
      offeredIp: dhcpObservations.offeredIp,
      subnetMask: dhcpObservations.subnetMask,
      router: dhcpObservations.router,
      dnsServers: dhcpObservations.dnsServers,
      seenAt: dhcpObservations.seenAt,
      sensorSlug: sensors.slug,
    })
    .from(dhcpObservations)
    .innerJoin(scanRuns, eq(dhcpObservations.scanRunId, scanRuns.id))
    .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
    .where(where)
    .orderBy(desc(dhcpObservations.seenAt))
    .limit(500);
}

// ---- DHCP analysis (consolidated scope + per-client view) -----------------

/** Normalize NetMon's message-type strings: "DHCPDISCOVER" -> "DISCOVER". */
function dhcpType(t: string | null): string {
  if (!t) return "?";
  return t.toUpperCase().replace(/^DHCP/, "").trim() || "?";
}

/** Dotted netmask -> prefix length (e.g. 255.255.252.0 -> 22), or null. */
function maskToPrefix(mask: string | null): number | null {
  if (!mask) return null;
  const parts = mask.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
  let bits = 0;
  for (const o of parts) bits += ((o >>> 0).toString(2).match(/1/g) ?? []).length;
  return bits;
}

/** ip + dotted-mask -> "network/prefix" (e.g. 10.20.4.7 /22 -> 10.20.4.0/22). */
function networkCidr(ip: string | null, mask: string | null): string | null {
  if (!ip || !mask) return null;
  const ipP = ip.split(".").map((p) => Number.parseInt(p, 10));
  const mP = mask.split(".").map((p) => Number.parseInt(p, 10));
  if (ipP.length !== 4 || mP.length !== 4) return null;
  if ([...ipP, ...mP].some((n) => Number.isNaN(n))) return null;
  const net = ipP.map((o, i) => o & mP[i]).join(".");
  const prefix = maskToPrefix(mask);
  return prefix == null ? null : `${net}/${prefix}`;
}

export interface DhcpScope {
  network: string;
  router: string | null;
  dnsServers: string | null;
  servers: string[];
  clients: number;
  offeredIps: number;
  offers: number;
  acks: number;
  naks: number;
}

export interface DhcpClientMessage {
  type: string;
  offeredIp: string | null;
  serverIp: string | null;
  seenAt: Date | null;
}

export type DhcpClientStatus = "ok" | "incomplete" | "nak" | "no-response";

export interface DhcpClientView {
  clientMac: string;
  status: DhcpClientStatus;
  lastOfferedIp: string | null;
  server: string | null;
  network: string | null;
  types: string[];
  count: number;
  messages: DhcpClientMessage[];
  /** Canonical entity this client MAC resolves to (for click-through), if known. */
  entityKind: "host" | "switch" | null;
  entityId: number | null;
}

export interface DhcpIssue {
  severity: "warning" | "info";
  title: string;
  detail: string;
}

export interface DhcpAnalysis {
  scanId: number | null;
  totalObservations: number;
  truncated: boolean;
  summary: { clients: number; scopes: number; servers: number; ackRate: number | null };
  scopes: DhcpScope[];
  servers: {
    ip: string;
    mac: string | null;
    messages: number;
    scopes: number;
    /** True/false when an authorized-server policy was supplied (AI-5); else undefined. */
    authorized?: boolean;
    /** Canonical entity this server IP resolves to (for click-through), if known. */
    entityKind?: "host" | "switch" | null;
    entityId?: number | null;
  }[];
  clients: DhcpClientView[];
  issues: DhcpIssue[];
}

const DHCP_ANALYSIS_LIMIT = 3000;

/**
 * Consolidated DHCP view for a school: derive scopes (subnets) from captured
 * OFFER/ACK options, roll observations up per client MAC into a lease story
 * (DISCOVER -> OFFER -> REQUEST -> ACK) with a success/issue status, and flag
 * problems (NAKs, clients getting no offer, multiple servers on one scope) so an
 * admin sees health at a glance instead of scrolling raw packets.
 */
export async function getDhcpAnalysis(
  schoolId: number,
  opts: { scanId?: number; authorizedServers?: Set<string> } = {},
): Promise<DhcpAnalysis> {
  // AI-5: when the district has declared an authorized DHCP-server allow-list,
  // make the deterministic issues authorization-aware so we don't tell the model
  // (or the dashboard) that expected failover servers look "rogue".
  const authz = opts.authorizedServers;
  const where = opts.scanId
    ? and(eq(sensors.schoolId, schoolId), eq(dhcpObservations.scanRunId, opts.scanId))
    : eq(sensors.schoolId, schoolId);

  const rows = await db
    .select({
      messageType: dhcpObservations.messageType,
      serverIp: dhcpObservations.serverIp,
      serverMac: dhcpObservations.serverMac,
      clientMac: dhcpObservations.clientMac,
      offeredIp: dhcpObservations.offeredIp,
      subnetMask: dhcpObservations.subnetMask,
      router: dhcpObservations.router,
      dnsServers: dhcpObservations.dnsServers,
      seenAt: dhcpObservations.seenAt,
    })
    .from(dhcpObservations)
    .innerJoin(scanRuns, eq(dhcpObservations.scanRunId, scanRuns.id))
    .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
    .where(where)
    .orderBy(desc(dhcpObservations.seenAt))
    .limit(DHCP_ANALYSIS_LIMIT + 1);

  const truncated = rows.length > DHCP_ANALYSIS_LIMIT;
  const obs = truncated ? rows.slice(0, DHCP_ANALYSIS_LIMIT) : rows;

  // Resolve client MACs + server IPs to canonical entities for click-through.
  const deviceIndex = await getSchoolDeviceIndex(schoolId);

  // ---- scopes (keyed by derived network CIDR) ----
  const scopeMap = new Map<
    string,
    DhcpScope & { _clients: Set<string>; _ips: Set<string> }
  >();
  // ---- servers ----
  const serverMap = new Map<
    string,
    { ip: string; mac: string | null; messages: number; _scopes: Set<string> }
  >();
  // ---- clients ----
  const clientMap = new Map<string, DhcpClientView>();

  let ackCount = 0;
  let discoverCount = 0;

  for (const r of obs) {
    const type = dhcpType(r.messageType);
    if (type === "ACK") ackCount++;
    if (type === "DISCOVER") discoverCount++;
    const network = networkCidr(r.offeredIp, r.subnetMask);

    // scope rollup (only rows that carry subnet info contribute a scope)
    if (network) {
      const s = scopeMap.get(network) ?? {
        network,
        router: r.router,
        dnsServers: r.dnsServers,
        servers: [],
        clients: 0,
        offeredIps: 0,
        offers: 0,
        acks: 0,
        naks: 0,
        _clients: new Set<string>(),
        _ips: new Set<string>(),
      };
      if (!s.router && r.router) s.router = r.router;
      if (!s.dnsServers && r.dnsServers) s.dnsServers = r.dnsServers;
      if (r.serverIp && !s.servers.includes(r.serverIp)) s.servers.push(r.serverIp);
      if (r.clientMac) s._clients.add(r.clientMac);
      if (r.offeredIp) s._ips.add(r.offeredIp);
      if (type === "OFFER") s.offers++;
      if (type === "ACK") s.acks++;
      if (type === "NAK") s.naks++;
      scopeMap.set(network, s);
    }

    // server rollup
    if (r.serverIp) {
      const sv = serverMap.get(r.serverIp) ?? {
        ip: r.serverIp,
        mac: r.serverMac,
        messages: 0,
        _scopes: new Set<string>(),
      };
      sv.messages++;
      if (!sv.mac && r.serverMac) sv.mac = r.serverMac;
      if (network) sv._scopes.add(network);
      serverMap.set(r.serverIp, sv);
    }

    // client rollup
    if (r.clientMac) {
      const c =
        clientMap.get(r.clientMac) ??
        ({
          clientMac: r.clientMac,
          status: "no-response" as DhcpClientStatus,
          lastOfferedIp: null,
          server: null,
          network: null,
          types: [],
          count: 0,
          messages: [],
          entityKind: null,
          entityId: null,
        } satisfies DhcpClientView);
      c.count++;
      if (!c.types.includes(type)) c.types.push(type);
      if (r.offeredIp) c.lastOfferedIp = r.offeredIp;
      if (r.serverIp && !c.server) c.server = r.serverIp;
      if (network && !c.network) c.network = network;
      // keep up to ~12 messages per client for the expandable conversation
      if (c.messages.length < 12) {
        c.messages.push({
          type,
          offeredIp: r.offeredIp,
          serverIp: r.serverIp,
          seenAt: r.seenAt,
        });
      }
      clientMap.set(r.clientMac, c);
    }
  }

  // finalize client status + resolve the MAC to a device for click-through
  for (const c of clientMap.values()) {
    const t = new Set(c.types);
    if (t.has("ACK")) c.status = "ok";
    else if (t.has("NAK")) c.status = "nak";
    else if (t.has("OFFER") || t.has("REQUEST")) c.status = "incomplete";
    else c.status = "no-response"; // only DISCOVER/INFORM seen, no server reply
    const ref = deviceIndex.byMac.get(c.clientMac.toLowerCase());
    c.entityKind = ref?.entityKind ?? null;
    c.entityId = ref?.entityId ?? null;
  }

  const scopes = [...scopeMap.values()]
    .map((s) => {
      s.clients = s._clients.size;
      s.offeredIps = s._ips.size;
      return s;
    })
    .sort((a, b) => b.clients - a.clients);

  const servers = [...serverMap.values()]
    .map((s) => {
      const ref = deviceIndex.byIp.get(s.ip);
      return {
        ip: s.ip,
        mac: s.mac,
        messages: s.messages,
        scopes: s._scopes.size,
        entityKind: ref?.entityKind ?? null,
        entityId: ref?.entityId ?? null,
        ...(authz ? { authorized: authz.has(s.ip) } : {}),
      };
    })
    .sort((a, b) => b.messages - a.messages);

  const clients = [...clientMap.values()].sort((a, b) => {
    const rank: Record<DhcpClientStatus, number> = {
      nak: 0,
      "no-response": 1,
      incomplete: 2,
      ok: 3,
    };
    return rank[a.status] - rank[b.status] || b.count - a.count;
  });

  // ---- issues ----
  const issues: DhcpIssue[] = [];
  const nakClients = clients.filter((c) => c.status === "nak");
  if (nakClients.length > 0) {
    issues.push({
      severity: "warning",
      title: `${nakClients.length} client${nakClients.length === 1 ? "" : "s"} received a DHCP NAK`,
      detail:
        "A NAK means the server refused the client's requested address (often a stale lease or wrong subnet). " +
        nakClients.slice(0, 5).map((c) => c.clientMac).join(", "),
    });
  }
  const noResp = clients.filter((c) => c.status === "no-response");
  if (noResp.length > 0) {
    issues.push({
      severity: "warning",
      title: `${noResp.length} client${noResp.length === 1 ? "" : "s"} got no DHCP response`,
      detail:
        "These MACs were seen sending DISCOVER/REQUEST but no OFFER/ACK was captured — possible scope exhaustion, no relay, or a one-off capture gap.",
    });
  }
  for (const s of scopes) {
    if (s.servers.length <= 1) continue;
    if (authz) {
      // Multiple AUTHORIZED servers on a scope = expected failover, not a problem.
      const unauthorized = s.servers.filter((ip) => !authz.has(ip));
      if (unauthorized.length === 0) continue;
      const authorized = s.servers.filter((ip) => authz.has(ip));
      issues.push({
        severity: "warning",
        title: `Scope ${s.network} has ${unauthorized.length} unauthorized DHCP server${unauthorized.length === 1 ? "" : "s"}`,
        detail:
          `Server(s) NOT on the district's authorized list answered this scope (possible rogue/misconfigured): ${unauthorized.join(", ")}. ` +
          `Authorized server(s) here: ${authorized.join(", ") || "none"}.`,
      });
    } else {
      issues.push({
        severity: "warning",
        title: `Scope ${s.network} served by ${s.servers.length} DHCP servers`,
        detail: `Multiple servers answering the same scope can indicate a rogue/misconfigured server: ${s.servers.join(", ")}.`,
      });
    }
  }
  if (authz) {
    // Only unauthorized servers are noteworthy; any number of authorized servers is fine.
    const unauthorizedServers = servers.filter((s) => !authz.has(s.ip));
    if (unauthorizedServers.length > 0) {
      issues.push({
        severity: "warning",
        title: `${unauthorizedServers.length} unauthorized DHCP server${unauthorizedServers.length === 1 ? "" : "s"} seen at this school`,
        detail: `Not on the district's authorized list: ${unauthorizedServers.map((s) => s.ip).join(", ")}.`,
      });
    }
  } else if (servers.length > 1) {
    issues.push({
      severity: "info",
      title: `${servers.length} DHCP servers seen at this school`,
      detail: servers.map((s) => s.ip).join(", "),
    });
  }

  return {
    scanId: opts.scanId ?? null,
    totalObservations: obs.length,
    truncated,
    summary: {
      clients: clients.length,
      scopes: scopes.length,
      servers: servers.length,
      ackRate: discoverCount > 0 ? ackCount / discoverCount : null,
    },
    scopes: scopes.map(({ _clients, _ips, ...rest }) => {
      void _clients;
      void _ips;
      return rest;
    }),
    servers,
    clients,
    issues,
  };
}

// ---- DNS health -----------------------------------------------------------

export interface DnsResolverRow {
  id: number;
  resolverIp: string | null;
  resolverSource: string | null;
  probes: number | null;
  ok: number | null;
  errors: number | null;
  nxdomainRewrite: boolean | null;
  meanMs: number | null;
}

export interface DnsProbeRow {
  id: number;
  resolverIp: string | null;
  resolverSource: string | null;
  queryName: string | null;
  queryType: string | null;
  expectedStatus: string | null;
  status: string | null;
  queryTimeMs: number | null;
  answerCount: number | null;
  answersText: string | null;
  error: string | null;
  probedAt: Date | null;
}

export interface DnsHealth {
  /** The scan these rows came from (resolved or explicit). */
  scanId: number | null;
  resolvers: DnsResolverRow[];
  probes: DnsProbeRow[];
}

/**
 * Resolver-health + per-query probes for a school. Resolves to the explicit
 * scanId, else the most-recent scan at the school that actually has DNS data
 * (DNS health is newer than some scans, so "latest scan" may have none).
 */
export async function listDnsForSchool(
  schoolId: number,
  opts: { scanId?: number } = {},
): Promise<DnsHealth> {
  let scanId = opts.scanId ?? null;
  if (scanId === null) {
    const [latest] = await db
      .select({ scanId: dnsResolverHealth.scanRunId })
      .from(dnsResolverHealth)
      .innerJoin(scanRuns, eq(dnsResolverHealth.scanRunId, scanRuns.id))
      .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
      .where(eq(sensors.schoolId, schoolId))
      .orderBy(desc(scanRuns.startedAt))
      .limit(1);
    scanId = latest?.scanId ?? null;
  }
  if (scanId === null) return { scanId: null, resolvers: [], probes: [] };

  // Guard the resolved/explicit scan belongs to this school.
  const guarded = and(
    eq(sensors.schoolId, schoolId),
    eq(scanRuns.id, scanId),
  );

  const [resolvers, probes] = await Promise.all([
    db
      .select({
        id: dnsResolverHealth.id,
        resolverIp: dnsResolverHealth.resolverIp,
        resolverSource: dnsResolverHealth.resolverSource,
        probes: dnsResolverHealth.probes,
        ok: dnsResolverHealth.ok,
        errors: dnsResolverHealth.errors,
        nxdomainRewrite: dnsResolverHealth.nxdomainRewrite,
        meanMs: dnsResolverHealth.meanMs,
      })
      .from(dnsResolverHealth)
      .innerJoin(scanRuns, eq(dnsResolverHealth.scanRunId, scanRuns.id))
      .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
      .where(guarded)
      .orderBy(dnsResolverHealth.resolverSource, dnsResolverHealth.resolverIp),
    db
      .select({
        id: dnsProbes.id,
        resolverIp: dnsProbes.resolverIp,
        resolverSource: dnsProbes.resolverSource,
        queryName: dnsProbes.queryName,
        queryType: dnsProbes.queryType,
        expectedStatus: dnsProbes.expectedStatus,
        status: dnsProbes.status,
        queryTimeMs: dnsProbes.queryTimeMs,
        answerCount: dnsProbes.answerCount,
        answersText: dnsProbes.answersText,
        error: dnsProbes.error,
        probedAt: dnsProbes.probedAt,
      })
      .from(dnsProbes)
      .innerJoin(scanRuns, eq(dnsProbes.scanRunId, scanRuns.id))
      .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
      .where(guarded)
      .orderBy(dnsProbes.resolverIp, dnsProbes.queryName),
  ]);

  return { scanId, resolvers, probes };
}

// ---- STP / spanning-tree --------------------------------------------------

export interface StpRow {
  id: number;
  bpduType: string | null;
  rootBridgeId: string | null;
  bridgeId: string | null;
  portId: string | null;
  rootPathCost: number | null;
  topologyChange: boolean | null;
  seenAt: Date | null;
  sensorSlug: string;
}

export interface StpSummary {
  total: number;
  topologyChanges: number;
  /** Distinct root bridge IDs observed — >1 can mean instability/misconfig. */
  rootBridges: string[];
  rows: StpRow[];
}

/**
 * Spanning-tree (BPDU) events for a school. Returns the recent events plus a
 * small summary (topology-change count, distinct root bridges) so the UI can
 * surface instability at a glance. Newest first, capped like the DHCP view.
 */
export async function listStpForSchool(
  schoolId: number,
  opts: { scanId?: number } = {},
): Promise<StpSummary> {
  const where = opts.scanId
    ? and(eq(sensors.schoolId, schoolId), eq(stpEvents.scanRunId, opts.scanId))
    : eq(sensors.schoolId, schoolId);

  const rows = await db
    .select({
      id: stpEvents.id,
      bpduType: stpEvents.bpduType,
      rootBridgeId: stpEvents.rootBridgeId,
      bridgeId: stpEvents.bridgeId,
      portId: stpEvents.portId,
      rootPathCost: stpEvents.rootPathCost,
      topologyChange: stpEvents.topologyChange,
      seenAt: stpEvents.seenAt,
      sensorSlug: sensors.slug,
    })
    .from(stpEvents)
    .innerJoin(scanRuns, eq(stpEvents.scanRunId, scanRuns.id))
    .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
    .where(where)
    .orderBy(desc(stpEvents.seenAt))
    .limit(500);

  const rootBridges = [
    ...new Set(rows.map((r) => r.rootBridgeId).filter((v): v is string => !!v)),
  ];
  return {
    total: rows.length,
    topologyChanges: rows.filter((r) => r.topologyChange).length,
    rootBridges,
    rows,
  };
}

// ---- network topology (maps) ----------------------------------------------

interface RawNode {
  id: string;
  type?: string;
  label?: string | null;
  ip?: string | null;
  hostCount?: number | null;
  // CORE-2: per-ifIndex interface health on fabric switch nodes.
  interfaces?: Record<string, SnmpInterface> | null;
  // The internet-facing device — the Internet node attaches here (graph.ts).
  isEdge?: boolean | null;
}
export interface TopoEdge {
  source: string;
  target: string;
  kind?: string | null;
  // MAP-3/MAP-4 (carried through from the stored snapshot edges).
  local_port?: string | null;
  remote_port?: string | null;
  stp_blocked?: boolean | null; // local STP port state is blocking → redundant link held down
  speed_mbps?: number | null; // local port ifHighSpeed
  // A synthesized link bridging a gap (not measured) — drawn dashed/muted.
  inferred?: boolean | null;
  inferredReason?: string | null;
  // A bundled port-channel: this one edge stands for `lagCount` parallel links.
  lagCount?: number | null;
}
/** Roll-up of endpoints attached to a switch (count + per-type breakdown), for
 *  the hover card — so endpoints stay off the canvas but are one hover away. */
export interface ConnectedSummary {
  count: number;
  byType: Record<string, number>;
}
/** Per-switch interface-health summary for the map hover. */
export interface IfaceSummary {
  total: number;
  up: number;
  down: number;
  errorPorts: number;
  blockedPorts: number;
}
/** A render-ready map node: refined type + entity link + hover detail. */
export interface MapNode {
  id: string;
  type: string;
  label: string;
  ip?: string | null;
  model?: string | null;
  vendor?: string | null;
  /** Firmware / OS string (best-effort: SNMP sysDescr for infra, classified OS for hosts). */
  firmware?: string | null;
  /** Access switch port for an FDB-attached leaf (e.g. "Gi1/0/12"). */
  port?: string | null;
  entityId?: number | null;
  entityKind?: "switch" | "host" | null;
  hostCount?: number | null;
  // MAP-4: interface health on switch nodes (full per-ifIndex map + a summary).
  interfaces?: Record<string, SnmpInterface> | null;
  ifaceSummary?: IfaceSummary | null;
  // The internet-facing edge device (Internet attaches here at render).
  isEdge?: boolean | null;
  // Endpoints attached to this switch (FDB roll-up) — shown in the hover card.
  connected?: ConnectedSummary | null;
  // >1 when this node is a collapsed switch stack ("stack ×N").
  stackCount?: number | null;
}
export interface MapGraph {
  nodes: MapNode[];
  edges: TopoEdge[];
  positions: Record<string, { x: number; y: number }>;
  generatedAt: Date | null;
}
export interface SchoolMap {
  physical: MapGraph;
  logical: MapGraph;
}

/** Read a string field off a jsonb `attributes` blob (null if absent/non-string). */
function mapAttrStr(attributes: unknown, key: string): string | null {
  if (attributes && typeof attributes === "object") {
    const v = (attributes as Record<string, unknown>)[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

/** MAP-4: roll a switch's per-interface health into hover-card counts. */
function summarizeInterfaces(
  ifaces: Record<string, SnmpInterface> | null | undefined,
): IfaceSummary | null {
  if (!ifaces) return null;
  const vals = Object.values(ifaces);
  if (vals.length === 0) return null;
  let up = 0;
  let down = 0;
  let errorPorts = 0;
  let blockedPorts = 0;
  for (const i of vals) {
    if (i.oper_status === "up") up++;
    else if (i.oper_status === "down") down++;
    if ((i.in_errors ?? 0) > 0 || (i.out_errors ?? 0) > 0) errorPorts++;
    if (i.stp_state === "blocking") blockedPorts++;
  }
  return { total: vals.length, up, down, errorPorts, blockedPorts };
}

/** Host OS string from the AI classification stash (attributes.classification.os). */
function hostOs(attributes: unknown): string | null {
  if (attributes && typeof attributes === "object") {
    const c = (attributes as Record<string, unknown>).classification;
    if (c && typeof c === "object") {
      const os = (c as Record<string, unknown>).os;
      if (typeof os === "string" && os.trim()) return os;
    }
  }
  return null;
}

/**
 * Resolve each host MAC to its most-specific (access) switch port via the bridge
 * forwarding table, disambiguating uplinks: a device's access port is the one
 * carrying the FEWEST MACs (an edge port usually has one; an uplink has many).
 * Uses the latest scan per sensor. Returns mac(lowercased) -> {switchIp, port}.
 */
/**
 * Switch-to-switch UPLINK ports for a school as `${switchIp}|${ifIndex}`, derived
 * from the physical topology fabric edges. Each crawled fabric edge carries the
 * LOCAL switch's uplink ifIndex (buildSnmpFabricGraph's `local_ifindex`); mapping
 * the edge's `switch:<chassis>` source to its mgmt IP gives (switchIp, ifIndex). The
 * SNMP crawl reports neighbors from both ends, so both sides of a link are covered.
 * Read-only + best-effort: an empty snapshot just yields an empty set (no exclusion).
 */
async function fabricUplinkPorts(schoolId: number): Promise<Set<string>> {
  const out = new Set<string>();
  const [snap] = await db
    .select({ graph: topologySnapshots.graph })
    .from(topologySnapshots)
    .where(
      and(
        eq(topologySnapshots.scopeType, "school"),
        eq(topologySnapshots.scopeId, schoolId),
        eq(topologySnapshots.kind, "physical"),
      ),
    )
    .limit(1);
  const edges = (snap?.graph as { edges?: unknown } | null)?.edges;
  if (!Array.isArray(edges) || edges.length === 0) return out;
  const swRows = await db
    .select({ chassisId: entitiesSwitch.chassisId, mgmtIp: entitiesSwitch.mgmtIp })
    .from(entitiesSwitch)
    .where(eq(entitiesSwitch.schoolId, schoolId));
  const ipByChassis = new Map(
    swRows.filter((s) => s.mgmtIp).map((s) => [s.chassisId, s.mgmtIp as string]),
  );
  for (const e of edges as Array<{ source?: unknown; target?: unknown; local_ifindex?: unknown }>) {
    const src = typeof e.source === "string" ? e.source : "";
    const tgt = typeof e.target === "string" ? e.target : "";
    if (!src.startsWith("switch:") || !tgt.startsWith("switch:")) continue; // both ends = fabric link
    const ip = ipByChassis.get(src.slice("switch:".length));
    const ifidx = e.local_ifindex;
    if (ip && (typeof ifidx === "string" || typeof ifidx === "number")) out.add(`${ip}|${ifidx}`);
  }
  return out;
}

async function getFdbAttachments(
  schoolId: number,
): Promise<Map<string, { switchIp: string; port: string | null }>> {
  // Latest scan PER SENSOR that produced FDB rows. FDB only lands on the periodic
  // SNMP/topology crawl (not every scan), so we need the latest scan that HAS
  // forwarding-table rows. Find it by MAXing scan_runs.id and probing the indexed
  // host_switch_ports.scan_run_id via EXISTS — instead of aggregating
  // max(host_switch_ports.scan_run_id) over 30 days of FDB history, which scanned
  // the entire (huge, per-MAC-per-scan) table and was the residual switch-detail +
  // map slowdown after the INV-6 fix only optimized the subsequent data load.
  const latestRows = await db
    .select({ sensorId: scanRuns.sensorId, maxScan: max(scanRuns.id) })
    .from(scanRuns)
    .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
    .where(
      and(
        eq(sensors.schoolId, schoolId),
        exists(
          db
            .select({ x: sql`1` })
            .from(hostSwitchPorts)
            .where(eq(hostSwitchPorts.scanRunId, scanRuns.id)),
        ),
      ),
    )
    .groupBy(scanRuns.sensorId);
  const scanIds = latestRows
    .map((r) => r.maxScan)
    .filter((n): n is number => n != null);
  if (scanIds.length === 0) {
    return new Map<string, { switchIp: string; port: string | null }>();
  }
  const fresh = await db
    .select({
      switchIp: hostSwitchPorts.sourceDeviceIp,
      mac: hostSwitchPorts.mac,
      ifName: hostSwitchPorts.ifName,
      ifIndex: hostSwitchPorts.ifIndex,
    })
    .from(hostSwitchPorts)
    .where(inArray(hostSwitchPorts.scanRunId, scanIds));

  // Switch-to-switch UPLINK ports (from the topology fabric edges). A device's MAC
  // learned on an uplink is in TRANSIT, not plugged in there — excluding those is
  // what stops an AP/bridge from being attached to a sibling stack it merely routes
  // through (the "fewest-MAC = access port" heuristic backfires for an AP whose own
  // access port carries all its wireless clients' MACs).
  const uplinkPorts = await fabricUplinkPorts(schoolId);

  // distinct MAC count per (switch, port)
  const portMacs = new Map<string, Set<string>>();
  for (const r of fresh) {
    if (!r.switchIp || !r.mac) continue;
    const key = `${r.switchIp}|${r.ifName ?? ""}`;
    let set = portMacs.get(key);
    if (!set) {
      set = new Set();
      portMacs.set(key, set);
    }
    set.add(r.mac.toLowerCase());
  }
  // pick the lowest-MAC-count port per MAC = its access port, EXCLUDING uplink ports
  const best = new Map<string, { switchIp: string; port: string | null; count: number }>();
  for (const r of fresh) {
    if (!r.switchIp || !r.mac) continue;
    // A device's MAC learned on a switch-to-switch uplink is in transit, not plugged
    // in there — drop that candidate. (A MAC seen ONLY on uplinks is genuinely transit
    // and correctly stays unattached.)
    if (r.ifIndex != null && uplinkPorts.has(`${r.switchIp}|${r.ifIndex}`)) continue;
    const mac = r.mac.toLowerCase();
    const count = portMacs.get(`${r.switchIp}|${r.ifName ?? ""}`)?.size ?? Number.MAX_SAFE_INTEGER;
    const cur = best.get(mac);
    if (!cur || count < cur.count) best.set(mac, { switchIp: r.switchIp, port: r.ifName, count });
  }
  const out = new Map<string, { switchIp: string; port: string | null }>();
  for (const [mac, v] of best) out.set(mac, { switchIp: v.switchIp, port: v.port });
  return out;
}

/**
 * Render-ready network map for a school: the physical (LLDP/CDP) and logical
 * (subnet/gateway) snapshots, with each node enriched from canonical entities
 * (refined device type, model, and a detail link), plus any saved manual
 * positions. The physical map is additionally overlaid with leaf devices
 * attached to their access switch port via the bridge FDB.
 */
export async function getSchoolMap(schoolId: number): Promise<SchoolMap> {
  const [snapRows, switchRows, hostRows, posRows] = await Promise.all([
    db
      .select({
        kind: topologySnapshots.kind,
        graph: topologySnapshots.graph,
        generatedAt: topologySnapshots.generatedAt,
      })
      .from(topologySnapshots)
      .where(
        and(eq(topologySnapshots.scopeType, "school"), eq(topologySnapshots.scopeId, schoolId)),
      ),
    db
      .select({
        id: entitiesSwitch.id,
        chassisId: entitiesSwitch.chassisId,
        systemName: entitiesSwitch.systemName,
        systemDescription: entitiesSwitch.systemDescription,
        mgmtIp: entitiesSwitch.mgmtIp,
        capabilities: entitiesSwitch.capabilities,
        attributes: entitiesSwitch.attributes,
        excludedAt: entitiesSwitch.excludedAt,
        mapHiddenAt: entitiesSwitch.mapHiddenAt,
      })
      .from(entitiesSwitch)
      .where(eq(entitiesSwitch.schoolId, schoolId)),
    db
      .select({
        id: entitiesHost.id,
        ip: entitiesHost.ip,
        mac: entitiesHost.mac,
        hostname: entitiesHost.hostname,
        deviceType: entitiesHost.deviceType,
        deviceTypeOverride: entitiesHost.deviceTypeOverride,
        vendor: entitiesHost.vendor,
        attributes: entitiesHost.attributes,
        excludedAt: entitiesHost.excludedAt,
        mapHiddenAt: entitiesHost.mapHiddenAt,
      })
      .from(entitiesHost)
      .where(eq(entitiesHost.schoolId, schoolId)),
    db
      .select({
        kind: topologyPositions.kind,
        nodeId: topologyPositions.nodeId,
        x: topologyPositions.x,
        y: topologyPositions.y,
      })
      .from(topologyPositions)
      .where(eq(topologyPositions.schoolId, schoolId)),
  ]);

  // Devices that must NOT appear on the map: purged (excludedAt) AND map-hidden
  // (mapHiddenAt — a reversible map-only hide that keeps the device in inventory +
  // SNMP). Both are pruned from the graph identically; collect their IPs/chassis to
  // strip from the stored snapshot, and key enrichment off mappable (visible) ones.
  const offMap = (e: { excludedAt: Date | null; mapHiddenAt: Date | null }) =>
    Boolean(e.excludedAt || e.mapHiddenAt);
  const excludedIps = new Set<string>();
  for (const s of switchRows) if (offMap(s) && s.mgmtIp) excludedIps.add(s.mgmtIp);
  for (const h of hostRows) if (offMap(h) && h.ip) excludedIps.add(h.ip);
  // Crawled switch/AP nodes are keyed `switch:<chassis>` and carry their address
  // as mgmt_ip, not ip — so match by chassis too, or a hide/purge of a
  // fabric-discovered device would never clear from the map.
  const excludedChassis = new Set<string>();
  for (const s of switchRows) if (offMap(s) && s.chassisId) excludedChassis.add(s.chassisId);
  const liveSwitches = switchRows.filter((s) => !offMap(s));
  const liveHosts = hostRows.filter((h) => !offMap(h));
  const switchByIp = new Map(liveSwitches.filter((s) => s.mgmtIp).map((s) => [s.mgmtIp!, s]));
  const switchByChassis = new Map(liveSwitches.map((s) => [s.chassisId, s]));
  const hostByIp = new Map(liveHosts.filter((h) => h.ip).map((h) => [h.ip!, h]));
  const posByKind = new Map<string, Record<string, { x: number; y: number }>>();
  for (const p of posRows) {
    const rec = posByKind.get(p.kind) ?? {};
    rec[p.nodeId] = { x: p.x, y: p.y };
    posByKind.set(p.kind, rec);
  }

  function enrich(kind: string, raw: RawNode[]): MapNode[] {
    return raw.map((n) => {
      const baseType = n.type ?? "host";
      // Resolve the switch entity by ip → mgmt_ip → chassis (`switch:<chassis>` id).
      // Fabric-crawled switches/APs carry their address as mgmt_ip (not ip), so an
      // ip-only match left them unlinked — breaking click-through. (queries.ts §map)
      const mgmt = (n as { mgmt_ip?: unknown }).mgmt_ip;
      const chassisFromId = n.id.startsWith("switch:") ? n.id.slice("switch:".length) : null;
      const sw =
        (n.ip ? switchByIp.get(n.ip) : undefined) ??
        (typeof mgmt === "string" ? switchByIp.get(mgmt) : undefined) ??
        (chassisFromId ? switchByChassis.get(chassisFromId) : undefined);
      if (sw) {
        const interfaces = n.interfaces ?? null; // CORE-2 per-port health on the snapshot node
        return {
          id: n.id,
          type: refineInfraType(baseType, sw.capabilities ?? null, sw.systemDescription),
          label: sw.systemName || n.label || n.ip || n.id,
          ip: n.ip ?? sw.mgmtIp ?? null,
          model: sw.systemDescription ?? null,
          vendor: mapAttrStr(sw.attributes, "vendor"),
          firmware: mapAttrStr(sw.attributes, "firmware") ?? mapAttrStr(sw.attributes, "os"),
          entityId: sw.id,
          entityKind: "switch",
          interfaces,
          ifaceSummary: summarizeInterfaces(interfaces),
          isEdge: n.isEdge ?? null,
        };
      }
      const host = n.ip && baseType !== "subnet" ? hostByIp.get(n.ip) : undefined;
      if (host) {
        return {
          id: n.id,
          // Manual reclassify (deviceTypeOverride) wins, so cleanup retags the map.
          type: host.deviceTypeOverride || (baseType === "gateway" ? "router" : baseType),
          label: host.hostname || n.label || n.ip || n.id,
          ip: n.ip ?? null,
          vendor: host.vendor ?? null,
          firmware: hostOs(host.attributes),
          entityId: host.id,
          entityKind: "host",
          isEdge: n.isEdge ?? null,
        };
      }
      return {
        id: n.id,
        type: refineInfraType(baseType, null, null),
        label: n.label || n.ip || n.id,
        ip: n.ip ?? null,
        hostCount: n.hostCount ?? null,
        isEdge: n.isEdge ?? null,
      };
    });
  }

  // A stored snapshot node that belongs to a purged/excluded entity — matched by
  // ip, by mgmt_ip (fabric switches/APs), or by chassis (the `switch:<chassis>` id).
  function isExcludedRawNode(n: RawNode): boolean {
    if (n.ip && excludedIps.has(n.ip)) return true;
    const mgmt = (n as { mgmt_ip?: unknown }).mgmt_ip;
    if (typeof mgmt === "string" && excludedIps.has(mgmt)) return true;
    const id = typeof n.id === "string" ? n.id : "";
    return id.startsWith("switch:") && excludedChassis.has(id.slice("switch:".length));
  }

  function build(kind: "physical" | "logical"): MapGraph {
    const row = snapRows.find((r) => r.kind === kind);
    const g = (row?.graph ?? {}) as { nodes?: RawNode[]; edges?: TopoEdge[] };
    // Prune, at read time, IP phones crawled as switches AND any purged/excluded
    // device — both linger forever in the union-merged snapshot otherwise.
    const rawNodes = (Array.isArray(g.nodes) ? g.nodes : []).filter(
      (n) => !isIpPhoneMapNode(n) && !isEndpointMapNode(n) && !isExcludedRawNode(n),
    );
    return {
      nodes: enrich(kind, rawNodes),
      edges: Array.isArray(g.edges) ? g.edges : [],
      positions: posByKind.get(kind) ?? {},
      generatedAt: row?.generatedAt ?? null,
    };
  }

  const physical = build("physical");
  const logical = build("logical");

  // --- FDB overlay + per-switch endpoint roll-up ----------------------------
  // Attach identified leaf devices to their access-switch port (so they appear
  // when endpoints are toggled on) AND tally a count/type breakdown per switch
  // IP for the hover card — the default infra-only canvas stays clean, but
  // "what's hanging off this switch" is one hover away.
  const fdb = await getFdbAttachments(schoolId);
  const rollupByIp = new Map<string, ConnectedSummary>();
  if (fdb.size > 0) {
    const switchNodeByIp = new Map<string, string>();
    for (const n of physical.nodes) if (n.ip) switchNodeByIp.set(n.ip, n.id);
    const hostByMac = new Map(
      liveHosts.filter((h) => h.mac).map((h) => [h.mac!.toLowerCase(), h]),
    );
    // A device physically sits on ONE switch — but an AP/bridge spreads its base +
    // radio/BSSID MACs across switches (incl. a transit uplink on a sibling stack),
    // which previously drew a separate "fdb" link to each, so an AP looked dual-homed.
    // Collapse each device's MACs to ONE access switch, preferring the attachment of
    // its CANONICAL MAC (its own/base MAC, learned on its real access port — not
    // bridged like the client MACs behind it).
    const attByHost = new Map<
      number,
      { host: (typeof liveHosts)[number]; switchIp: string; port: string | null; canonical: boolean }
    >();
    for (const [mac, att] of fdb) {
      if (!switchNodeByIp.has(att.switchIp)) continue; // access switch isn't on the map (yet)
      const host = hostByMac.get(mac);
      if (!host) continue; // unidentified MAC — skip until we know the device
      const canonical = (host.mac ?? "").toLowerCase() === mac;
      const cur = attByHost.get(host.id);
      if (!cur || (canonical && !cur.canonical)) {
        attByHost.set(host.id, { host, switchIp: att.switchIp, port: att.port, canonical });
      }
    }
    const present = new Set(physical.nodes.map((n) => n.id));
    for (const { host, switchIp, port } of attByHost.values()) {
      const swNode = switchNodeByIp.get(switchIp)!;
      // Tally toward this switch's connected-devices summary (keyed by switch IP
      // so stack members sharing a mgmt IP aggregate after collapse).
      const t = host.deviceTypeOverride || host.deviceType || "host";
      const sum = rollupByIp.get(switchIp) ?? { count: 0, byType: {} };
      sum.count++;
      sum.byType[t] = (sum.byType[t] ?? 0) + 1;
      rollupByIp.set(switchIp, sum);
      const hostNodeId = `host:${host.id}`;
      if (!present.has(hostNodeId)) {
        physical.nodes.push({
          id: hostNodeId,
          type: host.deviceTypeOverride || host.deviceType || "host",
          label: host.hostname || host.ip || String(host.mac ?? host.id),
          ip: host.ip,
          vendor: host.vendor ?? null,
          firmware: hostOs(host.attributes),
          port: port ?? null,
          entityId: host.id,
          entityKind: "host",
        });
        present.add(hostNodeId);
      }
      physical.edges.push({ source: hostNodeId, target: swNode, kind: "fdb" });
    }
  }

  // Collapse switch stacks into one node and bundle parallel LAG links into one
  // — the clean infra view the operator asked for. Runs after the FDB overlay so
  // attached-host edges get rewired onto the surviving stack node too.
  const physicalClean: MapGraph = { ...physical, ...collapseStacksAndLags(physical) };
  // Attach the endpoint roll-up to each (post-collapse) switch node by IP.
  for (const n of physicalClean.nodes) {
    if (n.entityKind === "switch" && n.ip) {
      const sum = rollupByIp.get(n.ip);
      if (sum) n.connected = sum;
    }
  }

  // Prune any excluded-device nodes that were baked into the stored snapshot,
  // plus edges that referenced them — so purging actually clears the map.
  function prune(g: MapGraph): MapGraph {
    const nodes = g.nodes.filter((n) => !(n.ip && excludedIps.has(n.ip)));
    const keep = new Set(nodes.map((n) => n.id));
    return { ...g, nodes, edges: g.edges.filter((e) => keep.has(e.source) && keep.has(e.target)) };
  }
  return { physical: prune(physicalClean), logical: prune(logical) };
}

/** Entity ids hidden from the map at a school — for filtering AI map context. */
export async function getMapHiddenKeys(
  schoolId: number,
): Promise<{ hostIds: Set<number>; switchIds: Set<number> }> {
  const [sw, ho] = await Promise.all([
    db
      .select({ id: entitiesSwitch.id })
      .from(entitiesSwitch)
      .where(and(eq(entitiesSwitch.schoolId, schoolId), isNotNull(entitiesSwitch.mapHiddenAt))),
    db
      .select({ id: entitiesHost.id })
      .from(entitiesHost)
      .where(and(eq(entitiesHost.schoolId, schoolId), isNotNull(entitiesHost.mapHiddenAt))),
  ]);
  return {
    switchIds: new Set(sw.map((r) => r.id)),
    hostIds: new Set(ho.map((r) => r.id)),
  };
}

export interface MapHiddenRow {
  key: string; // "switch:<id>" | "host:<id>"
  entityKind: "switch" | "host";
  entityId: number;
  name: string;
  ip: string | null;
  type: string;
}

/** Devices an operator has hidden from the map at this school — for the Hidden tab. */
export async function getMapHiddenForSchool(schoolId: number): Promise<MapHiddenRow[]> {
  const [switches, hosts] = await Promise.all([
    db
      .select({
        id: entitiesSwitch.id,
        systemName: entitiesSwitch.systemName,
        mgmtIp: entitiesSwitch.mgmtIp,
        chassisId: entitiesSwitch.chassisId,
        capabilities: entitiesSwitch.capabilities,
        systemDescription: entitiesSwitch.systemDescription,
      })
      .from(entitiesSwitch)
      .where(and(eq(entitiesSwitch.schoolId, schoolId), isNotNull(entitiesSwitch.mapHiddenAt))),
    db
      .select({
        id: entitiesHost.id,
        hostname: entitiesHost.hostname,
        ip: entitiesHost.ip,
        mac: entitiesHost.mac,
        deviceType: entitiesHost.deviceType,
        deviceTypeOverride: entitiesHost.deviceTypeOverride,
      })
      .from(entitiesHost)
      .where(and(eq(entitiesHost.schoolId, schoolId), isNotNull(entitiesHost.mapHiddenAt))),
  ]);
  const rows: MapHiddenRow[] = [
    ...switches.map((s) => ({
      key: `switch:${s.id}`,
      entityKind: "switch" as const,
      entityId: s.id,
      name: s.systemName || s.mgmtIp || s.chassisId,
      ip: s.mgmtIp,
      type: refineInfraType("switch", s.capabilities ?? null, s.systemDescription),
    })),
    ...hosts.map((h) => ({
      key: `host:${h.id}`,
      entityKind: "host" as const,
      entityId: h.id,
      name: h.hostname || h.ip || h.mac,
      ip: h.ip,
      type: h.deviceTypeOverride || h.deviceType || "host",
    })),
  ];
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

// ---- admin: managed entity tree (rename / delete / purge) -----------------

export interface ManagedSensor {
  id: number;
  slug: string;
  name: string | null;
  scanCount: number;
  firstScanAt: Date | null;
  lastScanAt: Date | null;
}
export interface ManagedSchool {
  id: number;
  slug: string;
  name: string | null;
  sensors: ManagedSensor[];
}
export interface ManagedDistrict {
  id: number;
  slug: string;
  name: string;
  schools: ManagedSchool[];
}

/**
 * Full district → school → sensor tree with per-sensor scan stats, for the
 * data-management admin page. Small dataset; stitched in JS.
 */
export async function getManagedTree(): Promise<ManagedDistrict[]> {
  const [dRows, sRows, senRows, scanAgg] = await Promise.all([
    db.select().from(districts).orderBy(districts.name),
    db.select().from(schools).orderBy(schools.slug),
    db.select().from(sensors).orderBy(sensors.slug),
    db
      .select({
        sensorId: scanRuns.sensorId,
        scanCount: count(scanRuns.id),
        firstScanAt: min(scanRuns.startedAt),
        lastScanAt: max(scanRuns.startedAt),
      })
      .from(scanRuns)
      .groupBy(scanRuns.sensorId),
  ]);

  const aggBySensor = new Map(scanAgg.map((a) => [a.sensorId, a]));
  const sensorsBySchool = new Map<number, ManagedSensor[]>();
  for (const s of senRows) {
    const agg = aggBySensor.get(s.id);
    const list = sensorsBySchool.get(s.schoolId) ?? [];
    list.push({
      id: s.id,
      slug: s.slug,
      name: s.name,
      scanCount: Number(agg?.scanCount ?? 0),
      firstScanAt: agg?.firstScanAt ? new Date(agg.firstScanAt) : null,
      lastScanAt: agg?.lastScanAt ? new Date(agg.lastScanAt) : null,
    });
    sensorsBySchool.set(s.schoolId, list);
  }

  const schoolsByDistrict = new Map<number, ManagedSchool[]>();
  for (const sc of sRows) {
    const list = schoolsByDistrict.get(sc.districtId) ?? [];
    list.push({
      id: sc.id,
      slug: sc.slug,
      name: sc.name,
      sensors: sensorsBySchool.get(sc.id) ?? [],
    });
    schoolsByDistrict.set(sc.districtId, list);
  }

  return dRows.map((d) => ({
    id: d.id,
    slug: d.slug,
    name: d.name,
    schools: schoolsByDistrict.get(d.id) ?? [],
  }));
}

// ---- admin: users + grants -------------------------------------------------

export interface ManagedUser {
  id: number;
  email: string;
  displayName: string | null;
  role: "superadmin" | "user" | "viewer";
  isBreakGlass: boolean;
  disabled: boolean;
  lastLoginAt: Date | null;
  /** District grants (id + name) — empty for superadmins (they see all). */
  districts: { id: number; name: string }[];
}

/** All users with their district grants, for the admin users page. */
export async function listUsersWithGrants(): Promise<ManagedUser[]> {
  const [userRows, grantRows, districtRows] = await Promise.all([
    db.select().from(users).orderBy(users.email),
    db
      .select({ userId: grants.userId, scopeType: grants.scopeType, scopeId: grants.scopeId })
      .from(grants),
    db.select({ id: districts.id, name: districts.name }).from(districts),
  ]);

  const districtName = new Map(districtRows.map((d) => [d.id, d.name]));
  const byUser = new Map<number, { id: number; name: string }[]>();
  for (const g of grantRows) {
    if (g.scopeType !== "district" || g.scopeId == null) continue;
    const list = byUser.get(g.userId) ?? [];
    list.push({ id: g.scopeId, name: districtName.get(g.scopeId) ?? `#${g.scopeId}` });
    byUser.set(g.userId, list);
  }

  return userRows.map((u) => ({
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    isBreakGlass: u.isBreakGlass,
    disabled: u.disabled,
    lastLoginAt: u.lastLoginAt,
    districts: (byUser.get(u.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

/** Simple id+name district list for grant pickers. */
export async function listDistrictOptions(): Promise<{ id: number; name: string }[]> {
  return db.select({ id: districts.id, name: districts.name }).from(districts).orderBy(districts.name);
}

// ---- sensor detail + config backups ---------------------------------------

export interface SensorDetail {
  id: number;
  slug: string;
  name: string | null;
  schoolId: number;
  agentVersion: string | null;
  reportedConfigVersion: number | null;
  lastCheckinAt: Date | null;
  createdAt: Date | null;
  lastScanAt: Date | null;
  scanCount: number;
  localIp: string | null;
  iface: string | null;
  ifaceCidr: string | null;
  reportedSha: string | null;
  reportedChannel: string | null;
  lastUpdateStatus: string | null;
  lastUpdateReason: string | null;
  lastUpdateFrom: string | null;
  lastUpdateTo: string | null;
  lastUpdateAt: string | null;
}

export async function getSensorDetail(
  schoolId: number,
  sensorId: number,
): Promise<SensorDetail | null> {
  const [s] = await db
    .select()
    .from(sensors)
    .where(and(eq(sensors.id, sensorId), eq(sensors.schoolId, schoolId)))
    .limit(1);
  if (!s) return null;
  const [agg] = await db
    .select({ c: count(scanRuns.id), last: max(scanRuns.startedAt) })
    .from(scanRuns)
    .where(eq(scanRuns.sensorId, sensorId));
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    schoolId: s.schoolId,
    agentVersion: s.agentVersion,
    reportedConfigVersion: s.reportedConfigVersion,
    lastCheckinAt: s.lastCheckinAt,
    createdAt: s.createdAt,
    lastScanAt: agg?.last ?? null,
    scanCount: Number(agg?.c ?? 0),
    localIp: s.localIp,
    iface: s.iface,
    ifaceCidr: s.ifaceCidr,
    reportedSha: s.reportedSha,
    reportedChannel: s.reportedChannel,
    lastUpdateStatus: s.lastUpdateStatus,
    lastUpdateReason: s.lastUpdateReason,
    lastUpdateFrom: s.lastUpdateFrom,
    lastUpdateTo: s.lastUpdateTo,
    lastUpdateAt: s.lastUpdateAt,
  };
}

export interface SensorNetwork {
  /** Scanning interface, e.g. "enp0s31f6" (uplink) or "enp0s31f6.30" (VLAN 30). */
  interface: string;
  /** Parsed from the interface suffix (eth0.30 -> 30); null for a plain NIC. */
  vlanId: number | null;
  /** Parent NIC for a VLAN sub-interface (eth0.30 -> eth0); null otherwise. */
  parent: string | null;
  /** The CIDR the box scanned from on this network (its DHCP/static lease). */
  cidr: string | null;
  gatewayIp: string | null;
  isPrimary: boolean;
  lastScanAt: Date | null;
  deviceCount: number;
  /** Scanned recently enough (≤ ~3 rescan intervals) to count as collecting. */
  fresh: boolean;
}

/** Derive (vlanId, parent) from a sub-interface name like "eth0.30" -> (30, "eth0"). */
function vlanOf(iface: string): { vlanId: number | null; parent: string | null } {
  const m = /^(.+)\.(\d{1,4})$/.exec(iface);
  if (!m) return { vlanId: null, parent: null };
  const vid = Number(m[2]);
  return vid >= 1 && vid <= 4094 ? { vlanId: vid, parent: m[1] } : { vlanId: null, parent: null };
}

/**
 * Per-network rollup for a sensor: the most recent scan per interface within a
 * recent window, with the IP it scanned from and how many devices it found.
 * Drives the sensor "Networks" card so an operator can see which VLANs are
 * actually collecting vs configured-but-silent. The dashboard has no vlan_id
 * column on scan_runs, so the VLAN id is parsed from the interface name.
 */
export async function getSensorNetworks(
  sensorId: number,
  withinDays = 14,
): Promise<SensorNetwork[]> {
  const since = new Date(Date.now() - withinDays * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      id: scanRuns.id,
      iface: scanRuns.interface,
      cidr: scanRuns.interfaceCidr,
      gatewayIp: scanRuns.gatewayIp,
      isPrimary: scanRuns.isPrimary,
      startedAt: scanRuns.startedAt,
    })
    .from(scanRuns)
    .where(
      and(
        eq(scanRuns.sensorId, sensorId),
        gte(scanRuns.startedAt, since),
        isNotNull(scanRuns.interface),
      ),
    )
    .orderBy(desc(scanRuns.startedAt));

  // Keep the most recent scan per interface name (rows are newest-first).
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    if (r.iface && !latest.has(r.iface)) latest.set(r.iface, r);
  }
  const latestRows = [...latest.values()];
  if (latestRows.length === 0) return [];

  // Device count for each network's most recent scan.
  const ids = latestRows.map((r) => r.id);
  const counts = await db
    .select({ scanId: devices.scanRunId, n: count() })
    .from(devices)
    .where(inArray(devices.scanRunId, ids))
    .groupBy(devices.scanRunId);
  const countByScan = new Map(counts.map((c) => [c.scanId, Number(c.n)]));

  const freshMs = 3 * 60 * 60 * 1000;
  const nowMs = Date.now();
  return latestRows
    .map((r) => {
      const { vlanId, parent } = vlanOf(r.iface ?? "");
      return {
        interface: r.iface ?? "",
        vlanId,
        parent,
        cidr: r.cidr,
        gatewayIp: r.gatewayIp,
        isPrimary: r.isPrimary,
        lastScanAt: r.startedAt,
        deviceCount: countByScan.get(r.id) ?? 0,
        fresh: r.startedAt != null && nowMs - r.startedAt.getTime() <= freshMs,
      };
    })
    .sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      if (a.vlanId != null && b.vlanId != null) return a.vlanId - b.vlanId;
      if (a.vlanId == null) return -1;
      if (b.vlanId == null) return 1;
      return a.interface.localeCompare(b.interface);
    });
}

export interface ConfigBackupRow {
  id: number;
  filename: string;
  capturedAt: Date | null;
  sizeBytes: number | null;
  importedAt: Date;
  manifest: Record<string, unknown>;
}

/** Config backups for a sensor (no file bytes — just metadata). Newest first. */
export async function listConfigBackups(sensorId: number): Promise<ConfigBackupRow[]> {
  const rows = await db
    .select({
      id: configBackups.id,
      filename: configBackups.filename,
      capturedAt: configBackups.capturedAt,
      sizeBytes: configBackups.sizeBytes,
      importedAt: configBackups.importedAt,
      manifest: configBackups.manifest,
    })
    .from(configBackups)
    .where(eq(configBackups.sensorId, sensorId))
    .orderBy(desc(configBackups.capturedAt), desc(configBackups.importedAt));
  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    capturedAt: r.capturedAt,
    sizeBytes: r.sizeBytes,
    importedAt: r.importedAt,
    manifest: (r.manifest ?? {}) as Record<string, unknown>,
  }));
}

export interface SensorManagement {
  enrolled: boolean;
  enrollLastUsedAt: Date | null;
  configVersion: number | null;
  config: Record<string, unknown> | null;
  commands: {
    id: number;
    command: string;
    status: string;
    createdAt: Date;
    sentAt: Date | null;
    result: Record<string, unknown> | null;
  }[];
}

/** Control-plane state for a sensor: enrollment, desired config, recent commands. */
export async function getSensorManagement(sensorId: number): Promise<SensorManagement> {
  const [enroll, cfg, cmds] = await Promise.all([
    db
      .select({ lastUsedAt: sensorEnrollments.lastUsedAt })
      .from(sensorEnrollments)
      .where(and(eq(sensorEnrollments.sensorId, sensorId), eq(sensorEnrollments.revoked, false)))
      .orderBy(desc(sensorEnrollments.createdAt))
      .limit(1),
    db
      .select({ v: desiredConfig.configVersion, config: desiredConfig.config })
      .from(desiredConfig)
      .where(eq(desiredConfig.sensorId, sensorId))
      .limit(1),
    db
      .select({
        id: commandQueue.id,
        command: commandQueue.command,
        status: commandQueue.status,
        createdAt: commandQueue.createdAt,
        sentAt: commandQueue.sentAt,
        result: commandResults.result,
      })
      .from(commandQueue)
      .leftJoin(commandResults, eq(commandResults.commandId, commandQueue.id))
      .where(eq(commandQueue.sensorId, sensorId))
      .orderBy(desc(commandQueue.createdAt))
      .limit(10),
  ]);

  return {
    enrolled: enroll.length > 0,
    enrollLastUsedAt: enroll[0]?.lastUsedAt ?? null,
    configVersion: cfg[0]?.v ?? null,
    config: (cfg[0]?.config as Record<string, unknown> | undefined) ?? null,
    commands: cmds.map((c) => ({
      ...c,
      result: (c.result as Record<string, unknown> | null) ?? null,
    })),
  };
}

/** Fetch a backup's bytes + the district/school it belongs to (for auth scope). */
export async function getConfigBackupForDownload(
  backupId: number,
): Promise<{ filename: string; contentB64: string; districtId: number; schoolId: number | null } | null> {
  const [row] = await db
    .select({
      filename: configBackups.filename,
      contentB64: configBackups.contentB64,
      districtId: schools.districtId,
      schoolId: sensors.schoolId,
    })
    .from(configBackups)
    .innerJoin(sensors, eq(configBackups.sensorId, sensors.id))
    .innerJoin(schools, eq(sensors.schoolId, schools.id))
    .where(eq(configBackups.id, backupId))
    .limit(1);
  return row ?? null;
}

/** Count scan_runs for a sensor within an optional [from,to] window. */
export async function countScansInRange(
  sensorId: number,
  from: Date | null,
  to: Date | null,
): Promise<number> {
  const clauses = [eq(scanRuns.sensorId, sensorId)];
  if (from) clauses.push(gte(scanRuns.startedAt, from));
  if (to) clauses.push(lte(scanRuns.startedAt, to));
  const [row] = await db
    .select({ n: count(scanRuns.id) })
    .from(scanRuns)
    .where(and(...clauses));
  return Number(row?.n ?? 0);
}
