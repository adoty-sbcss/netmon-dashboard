"use server";

/**
 * PERF-5 website-performance actions: manage the per-district website list + the
 * enable switch, and materialize both into EVERY sensor in the district's
 * desired_config (webperf_enabled + webperf_urls) so the collector's checkin writes
 * the JSON file the prober reads.
 */
import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { auditLog, sensors, schools } from "@/db/schema/app";
import { desiredConfig } from "@/db/schema/management";
import { getDistrictBySlug } from "@/db/queries";
import { getSessionUser } from "@/lib/auth/current-user";
import { getUserScope, scopeAllowsDistrict } from "@/lib/auth/scope";
import {
  addWebperfUrl,
  getDistrictWebperfEnabled,
  removeWebperfUrl,
  resolveWebperfUrls,
  setDistrictWebperfEnabled,
} from "@/lib/webperf";

export interface WebperfActionState {
  ok?: boolean;
  error?: string;
  message?: string;
}

async function audit(actor: string, action: string, detail: Record<string, unknown> = {}) {
  await db
    .insert(auditLog)
    .values({ actorType: "user", actor, action, detail })
    .catch((e) => console.error("webperf audit write failed", { action, error: String(e) }));
}

type AuthOk = {
  district: NonNullable<Awaited<ReturnType<typeof getDistrictBySlug>>>;
  user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;
};
async function authorizeDistrict(formData: FormData): Promise<AuthOk | { error: string }> {
  const user = await getSessionUser();
  if (!user) return { error: "Not authenticated." };
  const district = await getDistrictBySlug(String(formData.get("districtSlug") ?? ""));
  if (!district) return { error: "District not found." };
  const scope = await getUserScope(user);
  if (!scopeAllowsDistrict(scope, district.id)) return { error: "Not authorized for this district." };
  return { district, user };
}

/** Push the district's webperf config (enable + resolved URL list) into every one of
 *  its sensors' desired_config, atomically merged + version-bumped. Returns count. */
async function pushWebperfToDistrictSensors(districtId: number, actorId: number): Promise<number> {
  const [enabled, urls, rows] = await Promise.all([
    getDistrictWebperfEnabled(districtId),
    resolveWebperfUrls(districtId),
    db
      .select({ id: sensors.id })
      .from(sensors)
      .innerJoin(schools, eq(sensors.schoolId, schools.id))
      .where(eq(schools.districtId, districtId)),
  ]);
  const delta = JSON.stringify({ webperf_enabled: enabled, webperf_urls: urls });
  for (const s of rows) {
    await db
      .insert(desiredConfig)
      .values({ sensorId: s.id, configVersion: 1, config: sql`${delta}::jsonb`, updatedBy: actorId })
      .onConflictDoUpdate({
        target: desiredConfig.sensorId,
        set: {
          config: sql`${desiredConfig.config} || ${delta}::jsonb`,
          configVersion: sql`${desiredConfig.configVersion} + 1`,
          updatedBy: actorId,
          updatedAt: new Date(),
        },
      });
  }
  return rows.length;
}

export async function setWebperfEnabledAction(
  _prev: WebperfActionState,
  formData: FormData,
): Promise<WebperfActionState> {
  const a = await authorizeDistrict(formData);
  if ("error" in a) return a;
  const enabled = formData.get("enabled") === "on" || formData.get("enabled") === "true";
  await setDistrictWebperfEnabled(a.district.id, enabled, a.user.id);
  const n = await pushWebperfToDistrictSensors(a.district.id, a.user.id);
  await audit(a.user.email, "webperf_enabled_set", { district: a.district.slug, enabled, sensors: n });
  revalidatePath("/settings/network");
  return {
    ok: true,
    message: enabled
      ? `Website testing on — pushed to ${n} sensor${n === 1 ? "" : "s"} (applies on next check-in).`
      : `Website testing off (pushed to ${n} sensor${n === 1 ? "" : "s"}).`,
  };
}

export async function addWebperfUrlAction(
  _prev: WebperfActionState,
  formData: FormData,
): Promise<WebperfActionState> {
  const a = await authorizeDistrict(formData);
  if ("error" in a) return a;
  let url = String(formData.get("url") ?? "").trim();
  if (!url) return { error: "Enter a website URL." };
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  try {
    // eslint-disable-next-line no-new
    new URL(url);
  } catch {
    return { error: "That doesn't look like a valid URL." };
  }
  const label = String(formData.get("label") ?? "").trim() || null;
  await addWebperfUrl({ districtId: a.district.id, url, label, addedBy: a.user.id });
  const n = await pushWebperfToDistrictSensors(a.district.id, a.user.id);
  await audit(a.user.email, "webperf_url_added", { district: a.district.slug, url });
  revalidatePath("/settings/network");
  return { ok: true, message: `Added ${url} — pushed to ${n} sensor${n === 1 ? "" : "s"}.` };
}

export async function removeWebperfUrlAction(
  _prev: WebperfActionState,
  formData: FormData,
): Promise<WebperfActionState> {
  const a = await authorizeDistrict(formData);
  if ("error" in a) return a;
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return { error: "Invalid row." };
  await removeWebperfUrl(id, a.district.id);
  const n = await pushWebperfToDistrictSensors(a.district.id, a.user.id);
  await audit(a.user.email, "webperf_url_removed", { district: a.district.slug, id });
  revalidatePath("/settings/network");
  return { ok: true, message: `Removed — pushed to ${n} sensor${n === 1 ? "" : "s"}.` };
}
