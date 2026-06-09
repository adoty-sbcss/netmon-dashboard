"use server";

/**
 * Public speed-test actions (PERF-2): queue an on-demand run, and push the
 * enable/schedule/providers into the sensor's desired_config (pulled to the box,
 * applied as NETMON_SPEEDTEST_*). Superadmin-only. Mirrors iperf-actions.ts.
 */
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { auditLog } from "@/db/schema/app";
import { commandQueue, desiredConfig } from "@/db/schema/management";
import { getSessionUser } from "@/lib/auth/current-user";

export interface SpeedtestActionState {
  ok?: boolean;
  error?: string;
  message?: string;
}

async function audit(actor: string, action: string, detail: Record<string, unknown> = {}) {
  await db.insert(auditLog).values({ actorType: "user", actor, action, detail }).catch(() => {});
}

async function requireSuperadmin() {
  const u = await getSessionUser();
  return u && u.role === "superadmin" ? u : null;
}

const VALID = new Set(["ookla", "cloudflare"]);

function providersFromForm(formData: FormData): string {
  const out: string[] = [];
  if (formData.get("providerOokla") === "on") out.push("ookla");
  if (formData.get("providerCloudflare") === "on") out.push("cloudflare");
  return (out.length ? out : ["ookla"]).join(",");
}

/** Queue an on-demand public speed test (runs the configured/given provider(s)). */
export async function runSpeedtestAction(
  _prev: SpeedtestActionState,
  formData: FormData,
): Promise<SpeedtestActionState> {
  const admin = await requireSuperadmin();
  if (!admin) return { error: "Not authorized." };
  const sensorId = Number(formData.get("sensorId"));
  if (!Number.isInteger(sensorId)) return { error: "Invalid sensor." };

  const provider = String(formData.get("provider") ?? "");
  await db.insert(commandQueue).values({
    sensorId,
    command: "speedtest",
    // No provider => the sensor runs whatever its config lists (both by default).
    args: { provider: VALID.has(provider) ? provider : undefined, trigger: "manual" },
    status: "pending",
    requiresApproval: false,
    createdBy: admin.id,
  });
  await audit(admin.email, "speedtest_run_queued", { sensorId, provider: provider || "configured" });
  revalidatePath(String(formData.get("basePath") ?? "/"));
  return { ok: true, message: "Speed test queued — runs on the next check-in." };
}

/** Push speed-test enable/schedule/providers into desired_config (merged, bumped). */
export async function saveSpeedtestScheduleAction(
  _prev: SpeedtestActionState,
  formData: FormData,
): Promise<SpeedtestActionState> {
  const admin = await requireSuperadmin();
  if (!admin) return { error: "Not authorized." };
  const sensorId = Number(formData.get("sensorId"));
  if (!Number.isInteger(sensorId)) return { error: "Invalid sensor." };

  const enabled = formData.get("speedtestEnabled") === "on";
  const providers = providersFromForm(formData);
  const sched = Number(formData.get("scheduleSec"));
  // PERF-4: latency probing rides the same form (it's cheap — runs each check-in).
  const latencyEnabled = formData.get("latencyEnabled") === "on";

  const cfg = {
    speedtest_enabled: enabled,
    speedtest_providers: providers,
    // 15-min floor (speed tests use real bandwidth); default 6h.
    speedtest_schedule_sec: Number.isInteger(sched) && sched >= 900 ? sched : 6 * 3600,
    latency_enabled: latencyEnabled,
  };

  // Merge into the existing desired config (don't clobber SNMP/SFTP/iperf), bump version.
  const [existing] = await db
    .select({ v: desiredConfig.configVersion, config: desiredConfig.config })
    .from(desiredConfig)
    .where(eq(desiredConfig.sensorId, sensorId))
    .limit(1);
  const nextVersion = (existing?.v ?? 0) + 1;
  const config = { ...((existing?.config as Record<string, unknown>) ?? {}), ...cfg };

  await db
    .insert(desiredConfig)
    .values({ sensorId, configVersion: nextVersion, config, updatedBy: admin.id })
    .onConflictDoUpdate({
      target: desiredConfig.sensorId,
      set: { configVersion: nextVersion, config, updatedBy: admin.id, updatedAt: new Date() },
    });
  await audit(admin.email, "speedtest_schedule_saved", {
    sensorId,
    version: nextVersion,
    enabled,
    providers,
  });
  revalidatePath(String(formData.get("basePath") ?? "/"));
  return {
    ok: true,
    message: `Speed-test schedule saved (config v${nextVersion}) — applies on next check-in.`,
  };
}
