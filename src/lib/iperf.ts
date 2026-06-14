/**
 * Read/write iperf config + results (#10). District target server lives in
 * district_iperf; per-sensor schedule/params ride desired_config (pulled to the
 * box); results are reported by the sensor into iperf_results.
 */
import "server-only";
import { and, avg, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  districtIperf,
  iperfResults,
  speedtestResults,
  latencyResults,
  schoolCommittedRate,
  uplinkSamples,
} from "@/db/schema/iperf";
import { sensors } from "@/db/schema/app";

export interface DistrictIperfView {
  serverHost: string;
  serverPort: number;
  enabled: boolean;
}

export async function getDistrictIperf(districtId: number): Promise<DistrictIperfView> {
  const [row] = await db
    .select()
    .from(districtIperf)
    .where(eq(districtIperf.districtId, districtId))
    .limit(1);
  return {
    serverHost: row?.serverHost ?? "",
    serverPort: row?.serverPort ?? 5201,
    enabled: row?.enabled ?? false,
  };
}

export async function saveDistrictIperf(
  districtId: number,
  v: { serverHost: string; serverPort: number; enabled: boolean },
  updatedBy?: number | null,
): Promise<void> {
  const set = {
    serverHost: v.serverHost || null,
    serverPort: v.serverPort,
    enabled: v.enabled,
    updatedBy: updatedBy ?? null,
    updatedAt: new Date(),
  };
  await db
    .insert(districtIperf)
    .values({ districtId, ...set })
    .onConflictDoUpdate({ target: districtIperf.districtId, set });
}

export interface IperfResultRow {
  id: number;
  trigger: string | null;
  serverHost: string | null;
  serverPort: number | null;
  protocol: string | null;
  direction: string | null;
  durationSec: number | null;
  throughputMbps: number | null;
  retransmits: number | null;
  jitterMs: number | null;
  lossPct: number | null;
  ok: boolean;
  error: string | null;
  startedAt: Date | null;
  createdAt: Date;
}

export async function listIperfResults(
  sensorId: number,
  limit = 20,
): Promise<IperfResultRow[]> {
  return db
    .select({
      id: iperfResults.id,
      trigger: iperfResults.trigger,
      serverHost: iperfResults.serverHost,
      serverPort: iperfResults.serverPort,
      protocol: iperfResults.protocol,
      direction: iperfResults.direction,
      durationSec: iperfResults.durationSec,
      throughputMbps: iperfResults.throughputMbps,
      retransmits: iperfResults.retransmits,
      jitterMs: iperfResults.jitterMs,
      lossPct: iperfResults.lossPct,
      ok: iperfResults.ok,
      error: iperfResults.error,
      startedAt: iperfResults.startedAt,
      createdAt: iperfResults.createdAt,
    })
    .from(iperfResults)
    .where(eq(iperfResults.sensorId, sensorId))
    .orderBy(desc(iperfResults.createdAt))
    .limit(limit);
}

export interface SchoolIperfRow extends IperfResultRow {
  sensorId: number;
  sensorSlug: string;
  sensorName: string | null;
}

// --- public speed tests (PERF-2) -------------------------------------------

export interface SchoolSpeedtestRow {
  id: number;
  sensorId: number;
  sensorSlug: string;
  sensorName: string | null;
  trigger: string | null;
  provider: string | null;
  downloadMbps: number | null;
  uploadMbps: number | null;
  latencyMs: number | null;
  jitterMs: number | null;
  lossPct: number | null;
  server: string | null;
  isp: string | null;
  resultUrl: string | null;
  ok: boolean;
  error: string | null;
  startedAt: Date | null;
  createdAt: Date;
}

/** Every public speed-test result across a school's sensors (newest first). */
export async function listSchoolSpeedtests(
  schoolId: number,
  limit = 200,
): Promise<SchoolSpeedtestRow[]> {
  return db
    .select({
      id: speedtestResults.id,
      sensorId: speedtestResults.sensorId,
      sensorSlug: sensors.slug,
      sensorName: sensors.name,
      trigger: speedtestResults.trigger,
      provider: speedtestResults.provider,
      downloadMbps: speedtestResults.downloadMbps,
      uploadMbps: speedtestResults.uploadMbps,
      latencyMs: speedtestResults.latencyMs,
      jitterMs: speedtestResults.jitterMs,
      lossPct: speedtestResults.lossPct,
      server: speedtestResults.server,
      isp: speedtestResults.isp,
      resultUrl: speedtestResults.resultUrl,
      ok: speedtestResults.ok,
      error: speedtestResults.error,
      startedAt: speedtestResults.startedAt,
      createdAt: speedtestResults.createdAt,
    })
    .from(speedtestResults)
    .innerJoin(sensors, eq(speedtestResults.sensorId, sensors.id))
    .where(eq(sensors.schoolId, schoolId))
    .orderBy(desc(speedtestResults.createdAt))
    .limit(limit);
}

export interface SpeedtestResultRow {
  id: number;
  trigger: string | null;
  provider: string | null;
  downloadMbps: number | null;
  uploadMbps: number | null;
  latencyMs: number | null;
  jitterMs: number | null;
  lossPct: number | null;
  server: string | null;
  isp: string | null;
  resultUrl: string | null;
  ok: boolean;
  error: string | null;
  startedAt: Date | null;
  createdAt: Date;
}

/** Recent public speed-test results for one sensor (for its panel). */
export async function listSpeedtestResults(
  sensorId: number,
  limit = 20,
): Promise<SpeedtestResultRow[]> {
  return db
    .select({
      id: speedtestResults.id,
      trigger: speedtestResults.trigger,
      provider: speedtestResults.provider,
      downloadMbps: speedtestResults.downloadMbps,
      uploadMbps: speedtestResults.uploadMbps,
      latencyMs: speedtestResults.latencyMs,
      jitterMs: speedtestResults.jitterMs,
      lossPct: speedtestResults.lossPct,
      server: speedtestResults.server,
      isp: speedtestResults.isp,
      resultUrl: speedtestResults.resultUrl,
      ok: speedtestResults.ok,
      error: speedtestResults.error,
      startedAt: speedtestResults.startedAt,
      createdAt: speedtestResults.createdAt,
    })
    .from(speedtestResults)
    .where(eq(speedtestResults.sensorId, sensorId))
    .orderBy(desc(speedtestResults.createdAt))
    .limit(limit);
}

// --- latency / jitter / loss (PERF-4) --------------------------------------

export interface SchoolLatencyRow {
  id: number;
  sensorSlug: string;
  sensorName: string | null;
  label: string | null;
  target: string | null;
  latencyMs: number | null;
  jitterMs: number | null;
  lossPct: number | null;
  ok: boolean;
  createdAt: Date;
}

/** Recent latency probes across a school's sensors (newest first). */
export async function listSchoolLatency(
  schoolId: number,
  limit = 400,
): Promise<SchoolLatencyRow[]> {
  return db
    .select({
      id: latencyResults.id,
      sensorSlug: sensors.slug,
      sensorName: sensors.name,
      label: latencyResults.label,
      target: latencyResults.target,
      latencyMs: latencyResults.latencyMs,
      jitterMs: latencyResults.jitterMs,
      lossPct: latencyResults.lossPct,
      ok: latencyResults.ok,
      createdAt: latencyResults.createdAt,
    })
    .from(latencyResults)
    .innerJoin(sensors, eq(latencyResults.sensorId, sensors.id))
    .where(eq(sensors.schoolId, schoolId))
    .orderBy(desc(latencyResults.createdAt))
    .limit(limit);
}

// --- uplink utilization vs committed rate (PERF-3) -------------------------

export interface SchoolCommittedRateView {
  committedMbps: number | null;
  label: string | null;
  note: string | null;
  updatedAt: Date | null;
}

/** The admin-set committed/provisioned WAN rate for a school (null when unset). */
export async function getSchoolCommittedRate(
  schoolId: number,
): Promise<SchoolCommittedRateView> {
  const [row] = await db
    .select()
    .from(schoolCommittedRate)
    .where(eq(schoolCommittedRate.schoolId, schoolId))
    .limit(1);
  return {
    committedMbps: row?.committedMbps ?? null,
    label: row?.label ?? null,
    note: row?.note ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}

/** Upsert (or clear, when committedMbps is null) a school's committed WAN rate. */
export async function saveSchoolCommittedRate(
  schoolId: number,
  v: { committedMbps: number | null; label: string | null; note: string | null },
  updatedBy?: number | null,
): Promise<void> {
  const set = {
    committedMbps: v.committedMbps,
    label: v.label,
    note: v.note,
    updatedBy: updatedBy ?? null,
    updatedAt: new Date(),
  };
  await db
    .insert(schoolCommittedRate)
    .values({ schoolId, ...set })
    .onConflictDoUpdate({ target: schoolCommittedRate.schoolId, set });
}

export interface UplinkSampleRow {
  id: number;
  chassisId: string;
  ifindex: string;
  ifName: string | null;
  speedMbps: number | null;
  inMbps: number | null;
  outMbps: number | null;
  sampledAt: Date | null;
  createdAt: Date;
}

/** Uplink counter samples across a school's sensors (newest first). The page
 *  groups by (chassis, ifindex) and treats the busiest uplink as the WAN edge. */
export async function listSchoolUplinkSamples(
  schoolId: number,
  limit = 500,
): Promise<UplinkSampleRow[]> {
  return db
    .select({
      id: uplinkSamples.id,
      chassisId: uplinkSamples.chassisId,
      ifindex: uplinkSamples.ifindex,
      ifName: uplinkSamples.ifName,
      speedMbps: uplinkSamples.speedMbps,
      inMbps: uplinkSamples.inMbps,
      outMbps: uplinkSamples.outMbps,
      sampledAt: uplinkSamples.sampledAt,
      createdAt: uplinkSamples.createdAt,
    })
    .from(uplinkSamples)
    .where(eq(uplinkSamples.schoolId, schoolId))
    .orderBy(desc(uplinkSamples.createdAt))
    .limit(limit);
}

export interface UplinkDailyAvgRow {
  chassisId: string;
  ifindex: string;
  /** 'YYYY-MM-DD' (local to the DB session). */
  day: string;
  inMbps: number | null;
  outMbps: number | null;
}

/** Per-day average in/out Mbps for each uplink over the last `days` days (PERF-3
 *  long-range overview). Aggregated DB-side so the window doesn't depend on the
 *  raw-sample row cap (~hourly samples would blow past it in ~3 weeks). Days with
 *  no computed rate are omitted; the page selects the WAN uplink and charts it. */
export async function listSchoolUplinkDailyAvg(
  schoolId: number,
  days = 30,
): Promise<UplinkDailyAvgRow[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const tsExpr = sql`coalesce(${uplinkSamples.sampledAt}, ${uplinkSamples.createdAt})`;
  const dayExpr = sql<string>`to_char(${tsExpr}, 'YYYY-MM-DD')`;
  const rows = await db
    .select({
      chassisId: uplinkSamples.chassisId,
      ifindex: uplinkSamples.ifindex,
      day: dayExpr,
      inMbps: avg(uplinkSamples.inMbps),
      outMbps: avg(uplinkSamples.outMbps),
    })
    .from(uplinkSamples)
    .where(and(eq(uplinkSamples.schoolId, schoolId), sql`${tsExpr} >= ${since}`))
    .groupBy(uplinkSamples.chassisId, uplinkSamples.ifindex, dayExpr)
    .orderBy(dayExpr);
  return rows.map((r) => ({
    chassisId: r.chassisId,
    ifindex: r.ifindex,
    day: r.day,
    inMbps: r.inMbps == null ? null : Number(r.inMbps),
    outMbps: r.outMbps == null ? null : Number(r.outMbps),
  }));
}

/** Every iperf result across a school's sensors (newest first), with the sensor
 *  identity attached so the school view can compare bandwidth by IDF. */
export async function listSchoolIperfResults(
  schoolId: number,
  limit = 300,
): Promise<SchoolIperfRow[]> {
  return db
    .select({
      id: iperfResults.id,
      trigger: iperfResults.trigger,
      serverHost: iperfResults.serverHost,
      serverPort: iperfResults.serverPort,
      protocol: iperfResults.protocol,
      direction: iperfResults.direction,
      durationSec: iperfResults.durationSec,
      throughputMbps: iperfResults.throughputMbps,
      retransmits: iperfResults.retransmits,
      jitterMs: iperfResults.jitterMs,
      lossPct: iperfResults.lossPct,
      ok: iperfResults.ok,
      error: iperfResults.error,
      startedAt: iperfResults.startedAt,
      createdAt: iperfResults.createdAt,
      sensorId: iperfResults.sensorId,
      sensorSlug: sensors.slug,
      sensorName: sensors.name,
    })
    .from(iperfResults)
    .innerJoin(sensors, eq(iperfResults.sensorId, sensors.id))
    .where(eq(sensors.schoolId, schoolId))
    .orderBy(desc(iperfResults.createdAt))
    .limit(limit);
}
