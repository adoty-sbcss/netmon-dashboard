/**
 * Read/write iperf config + results (#10). District target server lives in
 * district_iperf; per-sensor schedule/params ride desired_config (pulled to the
 * box); results are reported by the sensor into iperf_results.
 */
import "server-only";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { districtIperf, iperfResults } from "@/db/schema/iperf";
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
