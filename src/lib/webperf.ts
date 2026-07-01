/**
 * PERF-5 website / end-user experience: read/write the per-district website list +
 * the enable switch, and read the results sensors report. The list is materialized
 * into each district sensor's desired_config by webperf-actions; an empty list falls
 * back to a couple of built-in defaults at push time.
 */
import "server-only";
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { districtWebperf, districtWebperfUrls, webperfResults } from "@/db/schema/iperf";
import { sensors } from "@/db/schema/app";

/** Sensible starter sites; admins add district-specific ones (LMS, testing portal). */
export const DEFAULT_WEBPERF_URLS = ["https://www.google.com", "https://www.office.com"];

export interface WebperfUrl {
  id: number;
  url: string;
  label: string | null;
  createdAt: Date;
}

export interface WebperfResultRow {
  id: number;
  sensorId: number;
  sensorName: string;
  url: string | null;
  trigger: string | null;
  dnsMs: number | null;
  tcpMs: number | null;
  tlsMs: number | null;
  ttfbMs: number | null;
  totalMs: number | null;
  httpStatus: number | null;
  speedMbps: number | null;
  ok: boolean;
  error: string | null;
  createdAt: Date;
}

export async function getDistrictWebperfEnabled(districtId: number): Promise<boolean> {
  const [row] = await db
    .select({ enabled: districtWebperf.enabled })
    .from(districtWebperf)
    .where(eq(districtWebperf.districtId, districtId))
    .limit(1);
  return row?.enabled ?? false;
}

export async function setDistrictWebperfEnabled(
  districtId: number,
  enabled: boolean,
  userId: number,
): Promise<void> {
  await db
    .insert(districtWebperf)
    .values({ districtId, enabled, updatedBy: userId })
    .onConflictDoUpdate({
      target: districtWebperf.districtId,
      set: { enabled, updatedBy: userId, updatedAt: new Date() },
    });
}

export async function listDistrictWebperfUrls(districtId: number): Promise<WebperfUrl[]> {
  return db
    .select({
      id: districtWebperfUrls.id,
      url: districtWebperfUrls.url,
      label: districtWebperfUrls.label,
      createdAt: districtWebperfUrls.createdAt,
    })
    .from(districtWebperfUrls)
    .where(eq(districtWebperfUrls.districtId, districtId))
    .orderBy(districtWebperfUrls.url);
}

export async function addWebperfUrl(input: {
  districtId: number;
  url: string;
  label?: string | null;
  addedBy?: number | null;
}): Promise<void> {
  await db
    .insert(districtWebperfUrls)
    .values({
      districtId: input.districtId,
      url: input.url,
      label: input.label ?? null,
      addedBy: input.addedBy ?? null,
    })
    .onConflictDoUpdate({
      target: [districtWebperfUrls.districtId, districtWebperfUrls.url],
      set: { label: input.label ?? null },
    });
}

/** Remove by row id, scoped to the district (defense in depth). */
export async function removeWebperfUrl(id: number, districtId: number): Promise<void> {
  await db
    .delete(districtWebperfUrls)
    .where(and(eq(districtWebperfUrls.id, id), eq(districtWebperfUrls.districtId, districtId)));
}

/** The effective URL list a sensor should test — the district's custom list, else
 *  the built-in defaults (so the feature works the moment it's switched on). */
export async function resolveWebperfUrls(districtId: number): Promise<string[]> {
  const rows = await listDistrictWebperfUrls(districtId);
  return rows.length ? rows.map((r) => r.url) : [...DEFAULT_WEBPERF_URLS];
}

/** Recent website-performance results for a school (joined via sensor, newest first). */
export async function listSchoolWebperf(
  schoolId: number,
  limit = 500,
): Promise<WebperfResultRow[]> {
  const rows = await db
    .select({
      id: webperfResults.id,
      sensorId: webperfResults.sensorId,
      sensorName: sensors.name,
      sensorSlug: sensors.slug,
      url: webperfResults.url,
      trigger: webperfResults.trigger,
      dnsMs: webperfResults.dnsMs,
      tcpMs: webperfResults.tcpMs,
      tlsMs: webperfResults.tlsMs,
      ttfbMs: webperfResults.ttfbMs,
      totalMs: webperfResults.totalMs,
      httpStatus: webperfResults.httpStatus,
      speedMbps: webperfResults.speedMbps,
      ok: webperfResults.ok,
      error: webperfResults.error,
      createdAt: webperfResults.createdAt,
    })
    .from(webperfResults)
    .innerJoin(sensors, eq(webperfResults.sensorId, sensors.id))
    .where(eq(sensors.schoolId, schoolId))
    .orderBy(desc(webperfResults.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    sensorName: r.sensorName ?? r.sensorSlug ?? `sensor ${r.sensorId}`,
  }));
}
