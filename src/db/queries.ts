/**
 * Server-only data access for the dashboard UI. Each function returns
 * view-model-shaped data so server components stay thin. No auth filtering yet
 * (added with the auth milestone) — for now every scope is visible.
 *
 * Counts are computed with grouped aggregate queries and merged in JS rather
 * than correlated subqueries: simpler to read and the dataset is small.
 */
import "server-only";
import { and, count, desc, eq, max, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { db } from "./index";
import {
  districts,
  schools,
  sensors,
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
} from "./schema/entities";

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

/** District → school tree for the sidebar. */
export async function getNavTree(): Promise<NavTree[]> {
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

export async function listDistricts(): Promise<DistrictSummary[]> {
  const [base, schoolCounts, sensorCounts, hostCounts, switchCounts, findingCounts, lastScans] =
    await Promise.all([
      db.select().from(districts).orderBy(districts.name),
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

  return deviceRows.map((d) => ({
    key: `d${d.id}`,
    entityId: d.mac ? (macToEntity.get(d.mac) ?? null) : null,
    hostname: d.hostname,
    vendor: d.vendor,
    mac: d.mac,
    ip: d.ip,
    source: d.source,
    switchPort: portLabel(d.mac ? portsByMac.get(d.mac) : undefined),
    firstSeenAt: d.firstSeenAt,
    lastSeenAt: d.lastSeenAt,
  }));
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

  return {
    id: host.id,
    mac: host.mac,
    ip: host.ip,
    hostname: host.hostname,
    vendor: host.vendor,
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
