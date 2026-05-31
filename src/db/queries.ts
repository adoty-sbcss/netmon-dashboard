/**
 * Server-only data access for the dashboard UI. Each function returns
 * view-model-shaped data so server components stay thin. No auth filtering yet
 * (added with the auth milestone) — for now every scope is visible.
 *
 * Counts are computed with grouped aggregate queries and merged in JS rather
 * than correlated subqueries: simpler to read and the dataset is small.
 */
import "server-only";
import { and, count, desc, eq, gte, inArray, lte, max, min, sql } from "drizzle-orm";
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
} from "./schema/netmon";
import {
  entitiesHost,
  entitiesSwitch,
  healthRollupDaily,
  topologySnapshots,
  topologyPositions,
} from "./schema/entities";
import { configBackups } from "./schema/management";
import { enrichHost, type DeviceType } from "../lib/oui";

// ---- shared shapes --------------------------------------------------------

export interface DistrictSummary {
  id: number;
  slug: string;
  name: string;
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
    schoolCount: sc.get(d.id)?.c ?? 0,
    sensorCount: sn.get(d.id)?.c ?? 0,
    hostCount: hc.get(d.id)?.c ?? 0,
    switchCount: wc.get(d.id)?.c ?? 0,
    findingCount: fc.get(d.id)?.c ?? 0,
    lastScanAt: ls.get(d.id)?.last ?? null,
  }));
}

export async function getDistrictBySlug(slug: string) {
  const [row] = await db
    .select()
    .from(districts)
    .where(eq(districts.slug, slug))
    .limit(1);
  return row ?? null;
}

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

export async function getSchoolBySlug(districtId: number, slug: string) {
  const [row] = await db
    .select()
    .from(schools)
    .where(and(eq(schools.districtId, districtId), eq(schools.slug, slug)))
    .limit(1);
  return row ?? null;
}

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

  // Latest scan per sensor (id + startedAt) via a window of max startedAt.
  const latest = await db
    .select({
      sensorId: scanRuns.sensorId,
      lastScanAt: max(scanRuns.startedAt),
    })
    .from(scanRuns)
    .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
    .where(eq(sensors.schoolId, schoolId))
    .groupBy(scanRuns.sensorId);

  const latestMap = new Map(latest.map((r) => [r.sensorId!, r.lastScanAt]));

  // Resolve the scan_run id + device count for each sensor's latest scan.
  const scanInfo = await Promise.all(
    sensorRows.map(async (s) => {
      const when = latestMap.get(s.id) ?? null;
      if (!when) return { sensorId: s.id, scanId: null, deviceCount: 0 };
      const [run] = await db
        .select({ id: scanRuns.id })
        .from(scanRuns)
        .where(
          and(eq(scanRuns.sensorId, s.id), eq(scanRuns.startedAt, when)),
        )
        .orderBy(desc(scanRuns.id))
        .limit(1);
      if (!run) return { sensorId: s.id, scanId: null, deviceCount: 0 };
      const [dc] = await db
        .select({ c: count() })
        .from(devices)
        .where(eq(devices.scanRunId, run.id));
      return { sensorId: s.id, scanId: run.id, deviceCount: dc?.c ?? 0 };
    }),
  );
  const infoMap = new Map(scanInfo.map((r) => [r.sensorId, r]));

  return sensorRows.map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    lastCheckinAt: s.lastCheckinAt,
    agentVersion: s.agentVersion,
    lastScanAt: latestMap.get(s.id) ?? null,
    lastScanId: infoMap.get(s.id)?.scanId ?? null,
    deviceCount: infoMap.get(s.id)?.deviceCount ?? 0,
  }));
}

export interface SchoolStats {
  hostCount: number;
  switchCount: number;
  deviceCount: number;
  neighborCount: number;
  dhcpCount: number;
  dnsCount: number;
  stpCount: number;
  findingCount: number;
  lastScanAt: Date | null;
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
    [stp],
    [find],
    [last],
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
    db.select({ c: count() }).from(stpEvents).where(inScans(stpEvents.scanRunId)),
    db.select({ c: count() }).from(findings).where(inScans(findings.scanRunId)),
    db
      .select({ last: max(scanRuns.startedAt) })
      .from(scanRuns)
      .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
      .where(eq(sensors.schoolId, schoolId)),
  ]);

  return {
    hostCount: host?.c ?? 0,
    switchCount: sw?.c ?? 0,
    deviceCount: dev?.c ?? 0,
    neighborCount: nb?.c ?? 0,
    dhcpCount: dhcp?.c ?? 0,
    dnsCount: dns?.c ?? 0,
    stpCount: stp?.c ?? 0,
    findingCount: find?.c ?? 0,
    lastScanAt: last?.last ?? null,
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
}

export interface SnmpAttr {
  oidName: string | null;
  value: string | null;
  deviceIp: string | null;
}

export interface HostDetail {
  id: number;
  mac: string;
  ip: string | null;
  hostname: string | null;
  vendor: string | null;
  deviceType: DeviceType | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  attributes: Record<string, unknown>;
  /** Resolved switch port (ifName / "port N"); null until a switch FDB resolves it. */
  switchPort: string | null;
  /** IP of the switch/gateway whose forwarding table produced the port mapping. */
  switchPortSource: string | null;
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
      })
      .from(devices)
      .innerJoin(scanRuns, eq(devices.scanRunId, scanRuns.id))
      .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
      .where(and(eq(sensors.schoolId, schoolId), eq(devices.mac, host.mac)))
      .orderBy(desc(scanRuns.startedAt)),
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

  return {
    id: host.id,
    mac: host.mac,
    ip: host.ip,
    hostname: host.hostname,
    vendor: vendor ?? host.vendor,
    deviceType: deviceType ?? (host.deviceType as DeviceType | null) ?? null,
    firstSeenAt: host.firstSeenAt,
    lastSeenAt: host.lastSeenAt,
    attributes: (host.attributes ?? {}) as Record<string, unknown>,
    switchPort: portLabel(port),
    switchPortSource: port?.sourceDeviceIp ?? null,
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
  return db
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
}

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
  attributes: Record<string, unknown>;
  appearances: SwitchAppearance[];
  snmp: SnmpAttr[];
  interfaceCount: number;
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
    .orderBy(desc(scanRuns.startedAt));

  let snmp: SnmpAttr[] = [];
  let interfaceCount = 0;
  if (sw.mgmtIp) {
    const [attrs, [ifc]] = await Promise.all([
      db
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
        .limit(40),
      db
        .select({ c: count() })
        .from(snmpPolls)
        .innerJoin(scanRuns, eq(snmpPolls.scanRunId, scanRuns.id))
        .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
        .where(
          and(
            eq(sensors.schoolId, schoolId),
            eq(snmpPolls.deviceIp, sw.mgmtIp),
            eq(snmpPolls.oidName, "ifTable"),
          ),
        ),
    ]);
    snmp = attrs;
    interfaceCount = ifc?.c ?? 0;
  }

  return {
    id: sw.id,
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
    interfaceCount,
  };
}

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
  servers: { ip: string; mac: string | null; messages: number; scopes: number }[];
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
  opts: { scanId?: number } = {},
): Promise<DhcpAnalysis> {
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

  // finalize client status
  for (const c of clientMap.values()) {
    const t = new Set(c.types);
    if (t.has("ACK")) c.status = "ok";
    else if (t.has("NAK")) c.status = "nak";
    else if (t.has("OFFER") || t.has("REQUEST")) c.status = "incomplete";
    else c.status = "no-response"; // only DISCOVER/INFORM seen, no server reply
  }

  const scopes = [...scopeMap.values()]
    .map((s) => {
      s.clients = s._clients.size;
      s.offeredIps = s._ips.size;
      return s;
    })
    .sort((a, b) => b.clients - a.clients);

  const servers = [...serverMap.values()]
    .map((s) => ({ ip: s.ip, mac: s.mac, messages: s.messages, scopes: s._scopes.size }))
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
    if (s.servers.length > 1) {
      issues.push({
        severity: "warning",
        title: `Scope ${s.network} served by ${s.servers.length} DHCP servers`,
        detail: `Multiple servers answering the same scope can indicate a rogue/misconfigured server: ${s.servers.join(", ")}.`,
      });
    }
  }
  if (servers.length > 1) {
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
}
export interface TopoEdge {
  source: string;
  target: string;
  kind?: string | null;
}
/** A render-ready map node: refined type + entity link + hover detail. */
export interface MapNode {
  id: string;
  type: string;
  label: string;
  ip?: string | null;
  model?: string | null;
  entityId?: number | null;
  entityKind?: "switch" | "host" | null;
  hostCount?: number | null;
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

function refineInfraType(
  base: string,
  caps: string[] | null,
  sysDescr: string | null,
): string {
  const c = (caps ?? []).map((s) => s.toLowerCase());
  if (c.some((x) => x.includes("access-point") || x.includes("wlan"))) return "ap";
  if (sysDescr && /access point|aironet|wireless lan|\bWAP\b/i.test(sysDescr)) return "ap";
  if (sysDescr && /firewall|fortigate|palo alto|\bASA\b|sonicwall/i.test(sysDescr)) return "firewall";
  if (c.includes("telephone")) return "phone";
  if (c.includes("router") && !c.includes("bridge")) return "router";
  if (sysDescr && /\brouter\b|\bISR\b|\bASR\b|RouterOS/i.test(sysDescr)) return "router";
  if (base === "gateway") return "router";
  if (base === "scanner") return "scanner";
  return "switch";
}

/**
 * Render-ready network map for a school: the physical (LLDP/CDP) and logical
 * (subnet/gateway) snapshots, with each node enriched from canonical entities
 * (refined device type, model, and a detail link), plus any saved manual
 * positions.
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
        systemName: entitiesSwitch.systemName,
        systemDescription: entitiesSwitch.systemDescription,
        mgmtIp: entitiesSwitch.mgmtIp,
        capabilities: entitiesSwitch.capabilities,
      })
      .from(entitiesSwitch)
      .where(eq(entitiesSwitch.schoolId, schoolId)),
    db
      .select({ id: entitiesHost.id, ip: entitiesHost.ip, hostname: entitiesHost.hostname })
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

  const switchByIp = new Map(switchRows.filter((s) => s.mgmtIp).map((s) => [s.mgmtIp!, s]));
  const hostByIp = new Map(hostRows.filter((h) => h.ip).map((h) => [h.ip!, h]));
  const posByKind = new Map<string, Record<string, { x: number; y: number }>>();
  for (const p of posRows) {
    const rec = posByKind.get(p.kind) ?? {};
    rec[p.nodeId] = { x: p.x, y: p.y };
    posByKind.set(p.kind, rec);
  }

  function enrich(kind: string, raw: RawNode[]): MapNode[] {
    return raw.map((n) => {
      const baseType = n.type ?? "host";
      const sw = n.ip ? switchByIp.get(n.ip) : undefined;
      if (sw) {
        return {
          id: n.id,
          type: refineInfraType(baseType, sw.capabilities ?? null, sw.systemDescription),
          label: sw.systemName || n.label || n.ip || n.id,
          ip: n.ip ?? sw.mgmtIp ?? null,
          model: sw.systemDescription ?? null,
          entityId: sw.id,
          entityKind: "switch",
        };
      }
      const host = n.ip && baseType !== "subnet" ? hostByIp.get(n.ip) : undefined;
      if (host) {
        return {
          id: n.id,
          type: baseType === "gateway" ? "router" : baseType,
          label: host.hostname || n.label || n.ip || n.id,
          ip: n.ip ?? null,
          entityId: host.id,
          entityKind: "host",
        };
      }
      return {
        id: n.id,
        type: refineInfraType(baseType, null, null),
        label: n.label || n.ip || n.id,
        ip: n.ip ?? null,
        hostCount: n.hostCount ?? null,
      };
    });
  }

  function build(kind: "physical" | "logical"): MapGraph {
    const row = snapRows.find((r) => r.kind === kind);
    const g = (row?.graph ?? {}) as { nodes?: RawNode[]; edges?: TopoEdge[] };
    return {
      nodes: enrich(kind, Array.isArray(g.nodes) ? g.nodes : []),
      edges: Array.isArray(g.edges) ? g.edges : [],
      positions: posByKind.get(kind) ?? {},
      generatedAt: row?.generatedAt ?? null,
    };
  }

  return { physical: build("physical"), logical: build("logical") };
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
  role: "superadmin" | "user";
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
  };
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
