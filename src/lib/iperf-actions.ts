"use server";

/**
 * iperf3 actions (#10): set the per-district target server, push a per-sensor
 * schedule into desired_config (pulled to the box), and queue an on-demand run.
 */
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { auditLog, sensors, schools } from "@/db/schema/app";
import { commandQueue, desiredConfig } from "@/db/schema/management";
import { getDistrictBySlug } from "@/db/queries";
import { getSessionUser } from "@/lib/auth/current-user";
import { getUserScope, scopeAllowsDistrict } from "@/lib/auth/scope";
import { getDistrictIperf, saveDistrictIperf } from "@/lib/iperf";

export interface IperfActionState {
  ok?: boolean;
  error?: string;
  message?: string;
}

async function audit(actor: string, action: string, detail: Record<string, unknown> = {}) {
  await db
    .insert(auditLog)
    .values({ actorType: "user", actor, action, detail })
    .catch(() => {});
}

/** Resolve a sensor's district id (for the iperf target server). */
async function sensorDistrictId(sensorId: number): Promise<number | null> {
  const [s] = await db
    .select({ schoolId: sensors.schoolId })
    .from(sensors)
    .where(eq(sensors.id, sensorId))
    .limit(1);
  if (!s) return null;
  const [sc] = await db
    .select({ districtId: schools.districtId })
    .from(schools)
    .where(eq(schools.id, s.schoolId))
    .limit(1);
  return sc?.districtId ?? null;
}

// ---- per-district target server (district Settings) -----------------------

export async function saveDistrictIperfAction(
  _prev: IperfActionState,
  formData: FormData,
): Promise<IperfActionState> {
  const user = await getSessionUser();
  if (!user) return { error: "Not authenticated." };
  const district = await getDistrictBySlug(String(formData.get("districtSlug") ?? ""));
  if (!district) return { error: "District not found." };
  const scope = await getUserScope(user);
  if (!scopeAllowsDistrict(scope, district.id)) {
    return { error: "Not authorized for this district." };
  }

  const serverHost = String(formData.get("serverHost") ?? "").trim();
  const port = Number(formData.get("serverPort"));
  const serverPort = Number.isInteger(port) && port > 0 && port < 65536 ? port : 5201;
  const enabled = formData.get("enabled") === "on";
  if (enabled && !serverHost) {
    return { error: "Enter the iperf3 server host to enable it." };
  }

  await saveDistrictIperf(district.id, { serverHost, serverPort, enabled }, user.id);
  await audit(user.email, "iperf_server_saved", { districtSlug: district.slug, serverHost, serverPort, enabled });
  revalidatePath(`/${district.slug}/settings`);
  revalidatePath("/settings/network");
  return { ok: true, message: "iperf server saved." };
}

// ---- per-sensor (superadmin management plane) -----------------------------

async function requireSuperadmin() {
  const u = await getSessionUser();
  return u && u.role === "superadmin" ? u : null;
}

const DIRECTIONS = new Set(["down", "up"]);
const PROTOCOLS = new Set(["tcp", "udp"]);

// ---- multi-schedule (cron-style) ------------------------------------------
const SCHED_DIRECTIONS = new Set(["down", "up", "both"]);
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/; // 24h HH:MM
const MAX_SCHEDULES = 12;
const MAX_TIMES = 8;
/** Schedule times are evaluated in this IANA zone on the box (see collector
 *  config.iperf_timezone) — "5am" means 5am Pacific regardless of the box clock. */
const SCHED_TIMEZONE = "America/Los_Angeles";

export interface IperfScheduleEntry {
  protocol: "tcp" | "udp";
  direction: "down" | "up" | "both";
  /** Seconds per test (1–60). */
  duration: number;
  /** 24h "HH:MM" times of day. */
  times: string[];
  /** Day indices, Mon=0 … Sun=6 (matches the collector's weekday()). */
  days: number[];
}

/** Parse + sanitize the editor's JSON into canonical schedule entries. Drops
 *  incomplete rows (no times or no days) and caps list/time counts so a bad
 *  client payload can't bloat the pushed config. */
function parseSchedules(raw: string): IperfScheduleEntry[] {
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: IperfScheduleEntry[] = [];
  for (const s of arr.slice(0, MAX_SCHEDULES)) {
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    const protocol = o.protocol === "udp" ? "udp" : "tcp";
    const dirStr = String(o.direction);
    const direction = (SCHED_DIRECTIONS.has(dirStr) ? dirStr : "down") as IperfScheduleEntry["direction"];
    const durNum = Number(o.duration);
    const duration = Number.isInteger(durNum) && durNum >= 1 && durNum <= 60 ? durNum : 10;
    const times = Array.isArray(o.times)
      ? [...new Set(o.times.map(String).filter((t) => TIME_RE.test(t)))].slice(0, MAX_TIMES)
      : [];
    const days = Array.isArray(o.days)
      ? [...new Set(o.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort(
          (a, b) => a - b,
        )
      : [];
    if (times.length === 0 || days.length === 0) continue;
    out.push({ protocol, direction, duration, times, days });
  }
  return out;
}

/** Queue an on-demand iperf run against the district server. */
export async function runIperfAction(
  _prev: IperfActionState,
  formData: FormData,
): Promise<IperfActionState> {
  const admin = await requireSuperadmin();
  if (!admin) return { error: "Not authorized." };
  const sensorId = Number(formData.get("sensorId"));
  if (!Number.isInteger(sensorId)) return { error: "Invalid sensor." };

  const districtId = await sensorDistrictId(sensorId);
  if (!districtId) return { error: "Sensor not found." };
  const iperf = await getDistrictIperf(districtId);
  if (!iperf.enabled || !iperf.serverHost) {
    return { error: "Configure the district iperf server first (district Settings)." };
  }

  const direction = String(formData.get("direction") ?? "down");
  const protocol = String(formData.get("protocol") ?? "tcp");
  const dur = Number(formData.get("duration"));
  await db.insert(commandQueue).values({
    sensorId,
    command: "iperf",
    args: {
      server: iperf.serverHost,
      port: iperf.serverPort,
      protocol: PROTOCOLS.has(protocol) ? protocol : "tcp",
      direction: DIRECTIONS.has(direction) ? direction : "down",
      duration: Number.isInteger(dur) && dur >= 1 && dur <= 60 ? dur : 10,
      trigger: "manual",
    },
    status: "pending",
    requiresApproval: false,
    createdBy: admin.id,
  });
  await audit(admin.email, "iperf_run_queued", { sensorId });
  revalidatePath(String(formData.get("basePath") ?? "/"));
  return { ok: true, message: "iperf run queued — executes on the next check-in." };
}

/** Push the iperf schedule + params to the sensor via desired_config (merged). */
export async function saveIperfScheduleAction(
  _prev: IperfActionState,
  formData: FormData,
): Promise<IperfActionState> {
  const admin = await requireSuperadmin();
  if (!admin) return { error: "Not authorized." };
  const sensorId = Number(formData.get("sensorId"));
  if (!Number.isInteger(sensorId)) return { error: "Invalid sensor." };

  const districtId = await sensorDistrictId(sensorId);
  if (!districtId) return { error: "Sensor not found." };
  const iperf = await getDistrictIperf(districtId);

  const enabled = formData.get("iperfEnabled") === "on";
  if (enabled && !iperf.serverHost) {
    return { error: "Set the district iperf server first (district Settings)." };
  }
  const schedules = parseSchedules(String(formData.get("schedules") ?? "[]"));
  if (enabled && schedules.length === 0) {
    return { error: "Add at least one schedule (a protocol/direction with a time and day)." };
  }

  const iperfCfg = {
    iperf_enabled: enabled,
    iperf_server: iperf.serverHost,
    iperf_port: iperf.serverPort,
    iperf_timezone: SCHED_TIMEZONE,
    iperf_schedules: schedules,
  };

  // Merge into the existing desired config (don't clobber SNMP/SFTP), bump version.
  const [existing] = await db
    .select({ v: desiredConfig.configVersion, config: desiredConfig.config })
    .from(desiredConfig)
    .where(eq(desiredConfig.sensorId, sensorId))
    .limit(1);
  const nextVersion = (existing?.v ?? 0) + 1;
  const config: Record<string, unknown> = {
    ...((existing?.config as Record<string, unknown>) ?? {}),
    ...iperfCfg,
  };
  // Retire the old single-interval keys so a stale value can't keep an updated
  // box running an interval test alongside the new cron schedules.
  delete config.iperf_schedule_sec;
  delete config.iperf_duration;
  delete config.iperf_direction;
  delete config.iperf_protocol;

  await db
    .insert(desiredConfig)
    .values({ sensorId, configVersion: nextVersion, config, updatedBy: admin.id })
    .onConflictDoUpdate({
      target: desiredConfig.sensorId,
      set: { configVersion: nextVersion, config, updatedBy: admin.id, updatedAt: new Date() },
    });
  await audit(admin.email, "iperf_schedule_saved", {
    sensorId,
    version: nextVersion,
    enabled,
    schedules: schedules.length,
  });
  revalidatePath(String(formData.get("basePath") ?? "/"));
  const count = schedules.length;
  return {
    ok: true,
    message: `iperf schedule saved (config v${nextVersion}) — ${count} schedule${count === 1 ? "" : "s"}, applies on next check-in.`,
  };
}
