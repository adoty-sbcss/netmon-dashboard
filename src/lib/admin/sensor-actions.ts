"use server";

/**
 * Phase 1 sensor control-plane actions (superadmin). Outbound-poll model: these
 * only queue desired state / commands; the sensor applies them on its next
 * check-in. Every action is audit-logged.
 */
import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { sensors, auditLog } from "@/db/schema/app";
import {
  desiredConfig,
  commandQueue,
  sensorEnrollments,
} from "@/db/schema/management";
import { getSessionUser } from "@/lib/auth/current-user";
import { hashToken } from "@/lib/sensor/auth";

export interface SensorActionState {
  error?: string;
  ok?: boolean;
  message?: string;
  /** Set once, immediately after enrollment — the plaintext token to copy. */
  token?: string;
}

const SAFE_COMMANDS = new Set(["run-scan", "upload-now", "config-backup", "collect-logs"]);

async function requireAdmin() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user.role === "superadmin" ? user : null;
}

async function audit(actor: string, action: string, detail: Record<string, unknown> = {}) {
  try {
    await db.insert(auditLog).values({ actorType: "user", actor, action, detail });
  } catch {
    // best-effort
  }
}

function basePathFor(formData: FormData): string {
  return String(formData.get("basePath") ?? "");
}

/** Generate (or rotate) a sensor's enrollment token. Returns the token ONCE. */
export async function enrollSensorAction(
  _prev: SensorActionState,
  formData: FormData,
): Promise<SensorActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };
  const sensorId = Number(formData.get("sensorId"));
  if (!Number.isInteger(sensorId)) return { error: "Invalid sensor." };

  const [sensor] = await db.select().from(sensors).where(eq(sensors.id, sensorId));
  if (!sensor) return { error: "That sensor no longer exists." };

  const token = `nms1_${randomBytes(24).toString("base64url")}`;
  await db.transaction(async (tx) => {
    // Rotate: revoke any existing tokens, then add the new one.
    await tx
      .update(sensorEnrollments)
      .set({ revoked: true })
      .where(eq(sensorEnrollments.sensorId, sensorId));
    await tx.insert(sensorEnrollments).values({ sensorId, tokenHash: hashToken(token) });
  });

  await audit(admin.email, "sensor_enrolled", { sensorId, slug: sensor.slug });
  revalidatePath(basePathFor(formData));
  return {
    ok: true,
    token,
    message: "Enrollment token created. Copy it now — it won't be shown again.",
  };
}

/** Save desired config (SNMP strings, scan interval); bumps the config version. */
export async function saveSensorConfigAction(
  _prev: SensorActionState,
  formData: FormData,
): Promise<SensorActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };
  const sensorId = Number(formData.get("sensorId"));
  if (!Number.isInteger(sensorId)) return { error: "Invalid sensor." };

  const snmpEnabled = formData.get("snmpEnabled") === "on";
  const snmpCommunities = String(formData.get("snmpCommunities") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(",");
  const rescanRaw = String(formData.get("rescanInterval") ?? "").trim();
  const rescanInterval = rescanRaw ? Number(rescanRaw) : null;
  if (rescanInterval != null && (!Number.isFinite(rescanInterval) || rescanInterval < 60)) {
    return { error: "Scan interval must be at least 60 seconds." };
  }

  // Optional SFTP upload destination push.
  const sftp: Record<string, unknown> = {};
  if (formData.has("sftpManage")) {
    sftp.sftp_enabled = formData.get("sftpEnabled") === "on";
    sftp.sftp_host = String(formData.get("sftpHost") ?? "").trim();
    const sp = Number(String(formData.get("sftpPort") ?? "22"));
    sftp.sftp_port = Number.isInteger(sp) && sp > 0 ? sp : 22;
    sftp.sftp_user = String(formData.get("sftpUser") ?? "").trim();
    sftp.sftp_remote_path = String(formData.get("sftpRemotePath") ?? "/").trim() || "/";
    const pw = String(formData.get("sftpPassword") ?? "");
    if (pw) sftp.sftp_password = pw; // only push when a new value is typed
  }

  const config = {
    snmp_enabled: snmpEnabled,
    snmp_communities: snmpCommunities,
    ...(rescanInterval != null ? { rescan_interval: rescanInterval } : {}),
    ...sftp,
  };

  const [existing] = await db
    .select({ v: desiredConfig.configVersion })
    .from(desiredConfig)
    .where(eq(desiredConfig.sensorId, sensorId));
  const nextVersion = (existing?.v ?? 0) + 1;

  await db
    .insert(desiredConfig)
    .values({ sensorId, configVersion: nextVersion, config, updatedBy: admin.id })
    .onConflictDoUpdate({
      target: desiredConfig.sensorId,
      set: { configVersion: nextVersion, config, updatedBy: admin.id, updatedAt: new Date() },
    });

  await audit(admin.email, "sensor_config_saved", { sensorId, version: nextVersion, config });
  revalidatePath(basePathFor(formData));
  return { ok: true, message: `Config v${nextVersion} saved — applies on the sensor's next check-in.` };
}

/** Queue a (safe) command for the sensor to run on its next check-in. */
export async function queueCommandAction(
  _prev: SensorActionState,
  formData: FormData,
): Promise<SensorActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };
  const sensorId = Number(formData.get("sensorId"));
  const command = String(formData.get("command") ?? "");
  if (!Number.isInteger(sensorId)) return { error: "Invalid sensor." };
  if (!SAFE_COMMANDS.has(command)) return { error: "Unknown command." };

  await db.insert(commandQueue).values({
    sensorId,
    command,
    status: "pending",
    requiresApproval: false,
    createdBy: admin.id,
  });

  await audit(admin.email, "sensor_command_queued", { sensorId, command });
  revalidatePath(basePathFor(formData));
  return { ok: true, message: `Queued “${command}” — runs on the next check-in.` };
}
