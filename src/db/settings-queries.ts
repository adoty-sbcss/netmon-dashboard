/**
 * Queries backing the consolidated /settings/network page. Kept in their own
 * module (like district-queries.ts / fleet-queries.ts) to stay clear of
 * concurrent edits in queries.ts.
 *
 * The settings page lists every sensor in a district with the capability flags
 * it currently has in its DESIRED config, so the per-sensor capability matrix
 * (enable SNMP / spine crawl / SFTP / iperf / speed tests / latency per box) can
 * seed its checkboxes from real state. We also surface whether the box has
 * applied its latest config (reportedConfigVersion vs configVersion) so an admin
 * can see a push is still pending.
 */
import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";

import { db } from "./index";
import { districts, schools, sensors } from "./schema/app";
import { desiredConfig, shellSessions } from "./schema/management";

export interface PendingConsoleApproval {
  sid: string;
  sensorId: number;
  sensorName: string | null;
  sensorSlug: string;
  schoolName: string | null;
  districtSlug: string;
  districtName: string | null;
  requestedByEmail: string | null;
  createdAt: Date | null;
  expiresAt: Date;
}

/** Console sessions awaiting super-admin approval (pending, not yet approved, not
 *  expired). Backs the in-app approvals list — the email-independent approve path. */
export async function listPendingConsoleApprovals(): Promise<PendingConsoleApproval[]> {
  return db
    .select({
      sid: shellSessions.id,
      sensorId: shellSessions.sensorId,
      sensorName: sensors.name,
      sensorSlug: sensors.slug,
      schoolName: schools.name,
      districtSlug: districts.slug,
      districtName: districts.name,
      requestedByEmail: shellSessions.openedByEmail,
      createdAt: shellSessions.createdAt,
      expiresAt: shellSessions.expiresAt,
    })
    .from(shellSessions)
    .innerJoin(sensors, eq(shellSessions.sensorId, sensors.id))
    .innerJoin(schools, eq(sensors.schoolId, schools.id))
    .innerJoin(districts, eq(schools.districtId, districts.id))
    .where(
      and(
        eq(shellSessions.status, "pending"),
        isNull(shellSessions.approvedAt),
        gt(shellSessions.expiresAt, new Date()),
      ),
    )
    .orderBy(shellSessions.createdAt);
}

/** All districts (id/name/slug) for the settings-page district picker. */
export async function listDistrictsForSettings(): Promise<
  { id: number; name: string | null; slug: string }[]
> {
  return db
    .select({ id: districts.id, name: districts.name, slug: districts.slug })
    .from(districts)
    .orderBy(districts.name);
}

/** The per-sensor capabilities the matrix toggles. Keys match desired_config. */
export interface SensorCapabilities {
  snmp_enabled: boolean;
  snmp_topology_enabled: boolean;
  sftp_enabled: boolean;
  iperf_enabled: boolean;
  speedtest_enabled: boolean;
  latency_enabled: boolean;
}

export interface SensorCapabilityRow extends SensorCapabilities {
  id: number;
  slug: string;
  name: string | null;
  schoolSlug: string;
  schoolName: string | null;
  lastCheckinAt: Date | null;
  /** The community currently pushed in desired config (what we want the box to use). */
  snmpCommunities: string;
  /** The community the box last reported running (ground truth from check-in). */
  reportedSnmpCommunities: string;
  /** Desired vs applied config version — a gap means a push is still pending. */
  configVersion: number | null;
  reportedConfigVersion: number | null;
}

const asBool = (v: unknown): boolean => v === true || v === "true";

/** Every sensor in a district + its current desired capability flags, grouped by
 *  school (schools alphabetical, then sensor slug). */
export async function listDistrictSensorCapabilities(
  districtId: number,
): Promise<SensorCapabilityRow[]> {
  const rows = await db
    .select({
      id: sensors.id,
      slug: sensors.slug,
      name: sensors.name,
      schoolSlug: schools.slug,
      schoolName: schools.name,
      lastCheckinAt: sensors.lastCheckinAt,
      reportedConfigVersion: sensors.reportedConfigVersion,
      reportedSnmpCommunities: sensors.reportedSnmpCommunities,
      configVersion: desiredConfig.configVersion,
      config: desiredConfig.config,
    })
    .from(sensors)
    .innerJoin(schools, eq(sensors.schoolId, schools.id))
    .leftJoin(desiredConfig, eq(desiredConfig.sensorId, sensors.id))
    .where(eq(schools.districtId, districtId))
    .orderBy(schools.name, sensors.slug);

  return rows.map((r) => {
    const cfg = (r.config as Record<string, unknown>) ?? {};
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      schoolSlug: r.schoolSlug,
      schoolName: r.schoolName,
      lastCheckinAt: r.lastCheckinAt,
      configVersion: r.configVersion,
      reportedConfigVersion: r.reportedConfigVersion,
      snmpCommunities: String(cfg.snmp_communities ?? ""),
      reportedSnmpCommunities: String(r.reportedSnmpCommunities ?? ""),
      snmp_enabled: asBool(cfg.snmp_enabled),
      snmp_topology_enabled: asBool(cfg.snmp_topology_enabled),
      sftp_enabled: asBool(cfg.sftp_enabled),
      iperf_enabled: asBool(cfg.iperf_enabled),
      speedtest_enabled: asBool(cfg.speedtest_enabled),
      latency_enabled: asBool(cfg.latency_enabled),
    };
  });
}

/**
 * The district's effective SNMP read community, for display on a device page:
 * ground truth (what sensors report) when they all agree, else the last pushed
 * (desired) value. Mirrors the logic on /settings/network. "" when none set.
 */
export async function getDistrictSnmpCommunity(districtId: number): Promise<string> {
  const rows = await listDistrictSensorCapabilities(districtId);
  const reported = [...new Set(rows.map((s) => s.reportedSnmpCommunities).filter(Boolean))];
  const desiredFallback = rows.find((s) => s.snmpCommunities)?.snmpCommunities ?? "";
  return reported.length === 1 ? reported[0] : desiredFallback;
}
