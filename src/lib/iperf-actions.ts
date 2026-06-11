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
  const sched = Number(formData.get("scheduleSec"));
  const dur = Number(formData.get("duration"));
  const direction = String(formData.get("direction") ?? "down");
  const protocol = String(formData.get("protocol") ?? "tcp");

  const iperfCfg = {
    iperf_enabled: enabled,
    iperf_server: iperf.serverHost,
    iperf_port: iperf.serverPort,
    iperf_schedule_sec: Number.isInteger(sched) && sched >= 300 ? sched : 3600,
    iperf_duration: Number.isInteger(dur) && dur >= 1 && dur <= 60 ? dur : 10,
    iperf_direction: DIRECTIONS.has(direction) ? direction : "down",
    iperf_protocol: PROTOCOLS.has(protocol) ? protocol : "tcp",
  };

  // Merge into the existing desired config (don't clobber SNMP/SFTP), bump version.
  const [existing] = await db
    .select({ v: desiredConfig.configVersion, config: desiredConfig.config })
    .from(desiredConfig)
    .where(eq(desiredConfig.sensorId, sensorId))
    .limit(1);
  const nextVersion = (existing?.v ?? 0) + 1;
  const config = { ...((existing?.config as Record<string, unknown>) ?? {}), ...iperfCfg };

  await db
    .insert(desiredConfig)
    .values({ sensorId, configVersion: nextVersion, config, updatedBy: admin.id })
    .onConflictDoUpdate({
      target: desiredConfig.sensorId,
      set: { configVersion: nextVersion, config, updatedBy: admin.id, updatedAt: new Date() },
    });
  await audit(admin.email, "iperf_schedule_saved", { sensorId, version: nextVersion, enabled });
  revalidatePath(String(formData.get("basePath") ?? "/"));
  return { ok: true, message: `iperf schedule saved (config v${nextVersion}) — applies on next check-in.` };
}
