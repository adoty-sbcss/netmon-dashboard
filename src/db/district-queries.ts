/**
 * District-wide rollups for the district aggregate pages (#2). Kept in a separate
 * module from queries.ts to stay clear of concurrent edits there. Each row
 * carries its school slug/name so the district views can link into the existing
 * per-school detail pages.
 */
import "server-only";
import { and, desc, eq, isNotNull } from "drizzle-orm";

import { db } from "./index";
import { schools, sensors } from "./schema/app";
import { entitiesHost, entitiesSwitch } from "./schema/entities";
import { scanRuns, findings, neighbors } from "./schema/netmon";

export interface DistrictHostRow {
  entityId: number;
  ip: string | null;
  mac: string | null;
  hostname: string | null;
  vendor: string | null;
  deviceType: string | null;
  schoolSlug: string | null;
  schoolName: string | null;
  lastSeenAt: Date | null;
}

export async function listDistrictHosts(districtId: number): Promise<DistrictHostRow[]> {
  return db
    .select({
      entityId: entitiesHost.id,
      ip: entitiesHost.ip,
      mac: entitiesHost.mac,
      hostname: entitiesHost.hostname,
      vendor: entitiesHost.vendor,
      deviceType: entitiesHost.deviceType,
      schoolSlug: schools.slug,
      schoolName: schools.name,
      lastSeenAt: entitiesHost.lastSeenAt,
    })
    .from(entitiesHost)
    .leftJoin(schools, eq(entitiesHost.schoolId, schools.id))
    .where(eq(entitiesHost.districtId, districtId))
    .orderBy(entitiesHost.ip);
}

export interface DistrictSwitchRow {
  id: number;
  systemName: string | null;
  systemDescription: string | null;
  mgmtIp: string | null;
  schoolSlug: string | null;
  schoolName: string | null;
  lastSeenAt: Date | null;
}

export async function listDistrictSwitches(districtId: number): Promise<DistrictSwitchRow[]> {
  return db
    .select({
      id: entitiesSwitch.id,
      systemName: entitiesSwitch.systemName,
      systemDescription: entitiesSwitch.systemDescription,
      mgmtIp: entitiesSwitch.mgmtIp,
      schoolSlug: schools.slug,
      schoolName: schools.name,
      lastSeenAt: entitiesSwitch.lastSeenAt,
    })
    .from(entitiesSwitch)
    .leftJoin(schools, eq(entitiesSwitch.schoolId, schools.id))
    .where(eq(entitiesSwitch.districtId, districtId))
    .orderBy(entitiesSwitch.systemName);
}

export interface DistrictFindingRow {
  id: number;
  severity: string;
  title: string;
  detail: string | null;
  rule: string;
  schoolSlug: string;
  schoolName: string | null;
  createdAt: Date | null;
}

export async function listDistrictFindings(
  districtId: number,
  limit = 200,
): Promise<DistrictFindingRow[]> {
  return db
    .select({
      id: findings.id,
      severity: findings.severity,
      title: findings.title,
      detail: findings.detail,
      rule: findings.rule,
      schoolSlug: schools.slug,
      schoolName: schools.name,
      createdAt: findings.createdAt,
    })
    .from(findings)
    .innerJoin(scanRuns, eq(findings.scanRunId, scanRuns.id))
    .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
    .innerJoin(schools, eq(sensors.schoolId, schools.id))
    .where(eq(schools.districtId, districtId))
    .orderBy(desc(findings.createdAt))
    .limit(limit);
}

export interface DistrictSensorRow {
  id: number;
  slug: string;
  name: string | null;
  schoolSlug: string;
  schoolName: string | null;
  lastCheckinAt: Date | null;
  agentVersion: string | null;
  localIp: string | null;
}

export async function listDistrictSensors(districtId: number): Promise<DistrictSensorRow[]> {
  return db
    .select({
      id: sensors.id,
      slug: sensors.slug,
      name: sensors.name,
      schoolSlug: schools.slug,
      schoolName: schools.name,
      lastCheckinAt: sensors.lastCheckinAt,
      agentVersion: sensors.agentVersion,
      localIp: sensors.localIp,
    })
    .from(sensors)
    .innerJoin(schools, eq(sensors.schoolId, schools.id))
    .where(eq(schools.districtId, districtId))
    .orderBy(schools.name, sensors.slug);
}

export interface NeighborRow {
  id: number;
  localPort: string | null;
  protocol: string | null;
  systemName: string | null;
  chassisId: string | null;
  portId: string | null;
  portDescription: string | null;
  systemDescription: string | null;
  vlanId: number | null;
  mgmtIp: string | null;
  sensorSlug: string;
  seenAt: Date | null;
}

/** LLDP/CDP neighbors seen at a school (most-recent first, deduped by
 *  chassis + local port so the same adjacency isn't listed per scan). */
export async function listNeighborsForSchool(schoolId: number): Promise<NeighborRow[]> {
  const rows = await db
    .select({
      id: neighbors.id,
      localPort: neighbors.localPort,
      protocol: neighbors.protocol,
      systemName: neighbors.systemName,
      chassisId: neighbors.chassisId,
      portId: neighbors.portId,
      portDescription: neighbors.portDescription,
      systemDescription: neighbors.systemDescription,
      vlanId: neighbors.vlanId,
      mgmtIp: neighbors.mgmtIp,
      sensorSlug: sensors.slug,
      seenAt: neighbors.seenAt,
    })
    .from(neighbors)
    .innerJoin(scanRuns, eq(neighbors.scanRunId, scanRuns.id))
    .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
    .where(and(eq(sensors.schoolId, schoolId), isNotNull(neighbors.chassisId)))
    .orderBy(desc(neighbors.seenAt));

  const seen = new Set<string>();
  const out: NeighborRow[] = [];
  for (const r of rows) {
    const key = `${r.chassisId}|${r.localPort ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
