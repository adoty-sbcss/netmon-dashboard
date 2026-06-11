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
import { sensors, auditLog, releaseSettings } from "@/db/schema/app";
import {
  desiredConfig,
  commandQueue,
  sensorEnrollments,
  shellSessions,
} from "@/db/schema/management";
import { headers } from "next/headers";

import { getSessionUser } from "@/lib/auth/current-user";
import { hashToken } from "@/lib/sensor/auth";
import { BROKER_WSS_URL, CONSOLE_TTL_MS, CONSOLE_ABS_MAX_MS } from "@/lib/admin/console-config";
import { clientIp } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/events";

export interface SensorActionState {
  error?: string;
  ok?: boolean;
  message?: string;
  /** Set once, immediately after enrollment — the plaintext token to copy. */
  token?: string;
  /** Set by openConsoleSessionAction — the operator's one-time WS credentials. */
  session?: {
    sid: string;
    operatorToken: string;
    broker: string;
    expiresAt: number;
  };
  /** Set by extendConsoleSessionAction — the new time-box (ms epoch). */
  extendedExpiresAt?: number;
}

const SAFE_COMMANDS = new Set([
  "run-scan",
  "upload-now",
  "config-backup",
  "collect-logs",
  // Remote code update: the box pulls + rebuilds on its next check-in, with the
  // collector's own healthcheck + auto-rollback. Honored by checkin.py (exit 11).
  "update",
  // Restricted read-only remote-console diagnostics (collector _DIAG_COMMANDS).
  // Fixed-argv, no injection surface; state-changing actions are NOT here.
  "diag-interfaces",
  "diag-routes",
  "diag-arp",
  "diag-disk",
  "diag-uptime",
  "diag-dns",
  "diag-ping",
  // "Test SFTP": connects/auths/lists the remote path (read-only) AND reports
  // whether uploads are actually enabled — a green connection test alone does
  // not mean bundles ship (the NETMON_SFTP_ENABLED footgun).
  "diag-sftp-test",
  "diag-selftest",
]);

/**
 * HOST-LEVEL maintenance actions (run OUTSIDE the container by the host wrapper).
 * Kept separate from SAFE_COMMANDS because they are state-changing + privileged
 * and must only be queued via queueHostActionAction (typed confirm + audit +
 * security event). Mirrors collector checkin.py:_HOST_ACTIONS, scripts/
 * host-action.sh, and console-config.ts HOST_ACTION_COMMANDS.
 */
const HOST_ACTION_COMMANDS = new Set([
  "host-restart",
  "host-rebuild",
  "host-rollback",
  "host-reboot",
]);

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

/**
 * Mirror a privileged control-plane change into the consolidated security feed
 * (category 'admin') so it surfaces on /security + the security AI, not just the
 * audit log. Best-effort (recordSecurityEvent never throws).
 */
async function adminEvent(
  actor: string,
  action: string,
  detail: Record<string, unknown> = {},
  severity: "info" | "low" | "medium" = "info",
  target: string | null = null,
) {
  const hdrs = await headers();
  await recordSecurityEvent({
    category: "admin",
    action,
    severity,
    actorType: "user",
    actor,
    sourceIp: clientIp(hdrs),
    userAgent: hdrs.get("user-agent"),
    target,
    detail,
  });
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
  await adminEvent(admin.email, "sensor_token_rotated", { sensorId, slug: sensor.slug }, "medium", `sensor:${sensorId}`);
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

  // Topology crawl scope + tuning push. Always present (the form renders it);
  // scope/enabled go through every save, numerics only when a value is typed
  // (blank = leave the box's current value, since _apply_config skips falsy).
  const topo: Record<string, unknown> = {};
  if (formData.has("topoManage")) {
    const scope = String(formData.get("topoScope") ?? "full").trim().toLowerCase();
    topo.snmp_topology_scope = scope === "spine" ? "spine" : "full";
    topo.snmp_topology_enabled = formData.get("topoEnabled") === "on";
    const intHours = String(formData.get("topoIntervalHours") ?? "").trim();
    if (intHours) {
      const h = Number(intHours);
      if (Number.isFinite(h) && h >= 0) topo.snmp_topology_interval = Math.floor(h * 3600);
    }
    const posInt = (name: string, key: string) => {
      const raw = String(formData.get(name) ?? "").trim();
      if (!raw) return;
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 1) topo[key] = Math.floor(n);
    };
    posInt("topoMaxNodes", "snmp_topology_max_nodes");
    posInt("topoFanoutCap", "snmp_topology_fanout_cap");
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
    ...topo,
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
  await adminEvent(admin.email, "sensor_config_pushed", { sensorId, version: nextVersion, keys: Object.keys(config) }, "info", `sensor:${sensorId}`);
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
  await adminEvent(admin.email, "sensor_command_queued", { sensorId, command }, command === "update" ? "medium" : "info", `sensor:${sensorId}`);
  revalidatePath(basePathFor(formData));
  return { ok: true, message: `Queued “${command}” — runs on the next check-in.` };
}

/**
 * Queue a HOST-LEVEL maintenance action (restart / rebuild / rollback / reboot)
 * that the in-container agent can't perform itself — the host wrapper drains +
 * runs it (collector checkin.py exit 12 -> scripts/host-action.sh). State-
 * changing + privileged, so it's gated behind a TYPE-TO-CONFIRM word (the
 * operator must type e.g. "REBOOT") + audit + a 'medium'/'high' security event.
 * NOTE: no second-approver flow yet (see console-config.ts) — vet with security.
 */
export async function queueHostActionAction(
  _prev: SensorActionState,
  formData: FormData,
): Promise<SensorActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };
  const sensorId = Number(formData.get("sensorId"));
  const command = String(formData.get("command") ?? "");
  const confirm = String(formData.get("confirm") ?? "").trim();
  if (!Number.isInteger(sensorId)) return { error: "Invalid sensor." };
  if (!HOST_ACTION_COMMANDS.has(command)) return { error: "Unknown host action." };

  // Defense in depth: the operator must type the action's confirm word. The UI
  // shows it; this re-checks server-side so a stray click can't fire it.
  const expectWord = command.replace(/^host-/, "").toUpperCase();
  if (confirm.toUpperCase() !== expectWord) {
    return { error: `Type ${expectWord} to confirm this action.` };
  }

  const heavy = command === "host-reboot" || command === "host-rollback";
  await db.insert(commandQueue).values({
    sensorId,
    command,
    status: "pending",
    // Dispatched on the next check-in. There is no second-approver UI yet, so
    // requiresApproval stays false; the typed confirm above is the gate.
    requiresApproval: false,
    createdBy: admin.id,
  });

  await audit(admin.email, "sensor_host_action_queued", { sensorId, command });
  await adminEvent(
    admin.email,
    "sensor_host_action_queued",
    { sensorId, command },
    heavy ? "medium" : "low",
    `sensor:${sensorId}`,
  );
  revalidatePath(basePathFor(formData));
  return {
    ok: true,
    message: `Queued “${command}” — the box runs it on its next check-in (watch the command history below).`,
  };
}

/**
 * Queue a code update for EVERY sensor (fleet-wide). Each box updates on its
 * next check-in; the ~10-min check-in timing + the collector's per-box jitter
 * stagger the rollout naturally so the fleet doesn't all rebuild at once. The
 * collector's healthcheck + auto-rollback protect each box.
 */
export async function bulkQueueUpdateAction(
  _prev: SensorActionState,
  formData: FormData,
): Promise<SensorActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };

  const all = await db.select({ id: sensors.id }).from(sensors);
  if (all.length === 0) return { error: "No sensors to update." };

  // Rely on column defaults (status='pending', requires_approval=false).
  await db
    .insert(commandQueue)
    .values(all.map((s) => ({ sensorId: s.id, command: "update", createdBy: admin.id })));

  await audit(admin.email, "sensor_bulk_update_queued", { count: all.length });
  await adminEvent(admin.email, "fleet_update_queued", { count: all.length }, "medium");
  revalidatePath(basePathFor(formData));
  return {
    ok: true,
    message: `Queued update for ${all.length} sensor(s) — each updates on its next check-in (rollout staggers by check-in timing).`,
  };
}

/**
 * Fleet-wide SFTP credential rotation: push the same SFTP destination to EVERY
 * sensor's desired config (merging into each box's existing config so SNMP etc.
 * is preserved) and bump each version. Each box flips on its next check-in; the
 * rollout view watches `reportedSftpUser`/`reportedConfigVersion` so you can
 * confirm every box is on the new creds before retiring the old SFTP user.
 */
export async function bulkSetSftpAction(
  _prev: SensorActionState,
  formData: FormData,
): Promise<SensorActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };

  const sftpHost = String(formData.get("sftpHost") ?? "").trim();
  const sftpUser = String(formData.get("sftpUser") ?? "").trim();
  if (!sftpHost || !sftpUser) return { error: "SFTP host and user are required." };
  const sp = Number(String(formData.get("sftpPort") ?? "22"));
  const sftp: Record<string, unknown> = {
    sftp_enabled: formData.get("sftpEnabled") === "on",
    sftp_host: sftpHost,
    sftp_port: Number.isInteger(sp) && sp > 0 ? sp : 22,
    sftp_user: sftpUser,
    sftp_remote_path: String(formData.get("sftpRemotePath") ?? "/").trim() || "/",
  };
  const pw = String(formData.get("sftpPassword") ?? "");
  if (pw) sftp.sftp_password = pw; // only push when a new value is typed

  // One row per sensor with its current desired config (null for never-configured).
  const rows = await db
    .select({
      sensorId: sensors.id,
      v: desiredConfig.configVersion,
      config: desiredConfig.config,
    })
    .from(sensors)
    .leftJoin(desiredConfig, eq(desiredConfig.sensorId, sensors.id));
  if (rows.length === 0) return { error: "No sensors to push to." };

  await db.transaction(async (tx) => {
    for (const row of rows) {
      const merged = { ...((row.config as Record<string, unknown>) ?? {}), ...sftp };
      const nextV = (row.v ?? 0) + 1;
      await tx
        .insert(desiredConfig)
        .values({ sensorId: row.sensorId, configVersion: nextV, config: merged, updatedBy: admin.id })
        .onConflictDoUpdate({
          target: desiredConfig.sensorId,
          set: { configVersion: nextV, config: merged, updatedBy: admin.id, updatedAt: new Date() },
        });
    }
  });

  await audit(admin.email, "sensor_bulk_sftp_set", {
    count: rows.length,
    host: sftpHost,
    user: sftpUser,
    passwordChanged: Boolean(pw),
  });
  await adminEvent(admin.email, "fleet_sftp_pushed", { count: rows.length, host: sftpHost, user: sftpUser, passwordChanged: Boolean(pw) }, "medium");
  revalidatePath(basePathFor(formData));
  return {
    ok: true,
    message: `Pushed SFTP creds to ${rows.length} sensor(s) — watch the rollout below as each box reports the new user, then retire the old SFTP account.`,
  };
}

/**
 * Fleet-wide topology-crawl scope/tuning push: merge the same crawl config (scope
 * full|spine + optional enable/interval/budgets) into EVERY sensor's desired
 * config and bump each version, so flipping the whole fleet to 'spine' is one
 * action. Merges (SNMP/SFTP preserved); each box applies on its next check-in.
 */
export async function bulkSetCrawlScopeAction(
  _prev: SensorActionState,
  formData: FormData,
): Promise<SensorActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };

  const scopeRaw = String(formData.get("topoScope") ?? "full").trim().toLowerCase();
  const scope = scopeRaw === "spine" ? "spine" : "full";
  const crawl: Record<string, unknown> = {
    snmp_topology_scope: scope,
    snmp_topology_enabled: formData.get("topoEnabled") === "on",
  };
  const intHours = String(formData.get("topoIntervalHours") ?? "").trim();
  if (intHours) {
    const h = Number(intHours);
    if (Number.isFinite(h) && h >= 0) crawl.snmp_topology_interval = Math.floor(h * 3600);
  }
  const posInt = (name: string, key: string) => {
    const raw = String(formData.get(name) ?? "").trim();
    if (!raw) return;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1) crawl[key] = Math.floor(n);
  };
  posInt("topoMaxNodes", "snmp_topology_max_nodes");
  posInt("topoFanoutCap", "snmp_topology_fanout_cap");

  const rows = await db
    .select({
      sensorId: sensors.id,
      v: desiredConfig.configVersion,
      config: desiredConfig.config,
    })
    .from(sensors)
    .leftJoin(desiredConfig, eq(desiredConfig.sensorId, sensors.id));
  if (rows.length === 0) return { error: "No sensors to push to." };

  await db.transaction(async (tx) => {
    for (const row of rows) {
      const merged = { ...((row.config as Record<string, unknown>) ?? {}), ...crawl };
      const nextV = (row.v ?? 0) + 1;
      await tx
        .insert(desiredConfig)
        .values({ sensorId: row.sensorId, configVersion: nextV, config: merged, updatedBy: admin.id })
        .onConflictDoUpdate({
          target: desiredConfig.sensorId,
          set: { configVersion: nextV, config: merged, updatedBy: admin.id, updatedAt: new Date() },
        });
    }
  });

  await audit(admin.email, "sensor_bulk_crawl_scope_set", { count: rows.length, scope });
  await adminEvent(admin.email, "fleet_crawl_scope_pushed", { count: rows.length, scope }, "medium");

  revalidatePath(basePathFor(formData));
  return {
    ok: true,
    message: `Pushed crawl scope "${scope}" to ${rows.length} sensor(s) — each applies on its next check-in (watch the rollout below).`,
  };
}

/**
 * Push the RECOMMENDED DEFAULTS to every existing sensor in one shot: enable the
 * SNMP spine crawl and both public speed tests. Merges into each box's existing
 * desired config (SFTP/iperf/etc. preserved) and bumps each version; every box
 * applies on its next check-in. This is the fleet-wide companion to the
 * new-install defaults baked into the deploy installer (deploy-sensor.tsx).
 *
 * NOTE: SNMP needs a community to actually crawl. We do NOT overwrite a box's
 * existing community here (that's district-specific) — boxes with none set get
 * the spine flags but won't crawl until a community is provided in settings.
 */
export async function bulkApplyRecommendedDefaultsAction(
  _prev: SensorActionState,
  formData: FormData,
): Promise<SensorActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };

  const defaults: Record<string, unknown> = {
    snmp_enabled: true,
    snmp_topology_enabled: true,
    snmp_topology_scope: "spine",
    speedtest_enabled: true,
    speedtest_providers: "ookla,cloudflare",
  };

  const rows = await db
    .select({
      sensorId: sensors.id,
      v: desiredConfig.configVersion,
      config: desiredConfig.config,
    })
    .from(sensors)
    .leftJoin(desiredConfig, eq(desiredConfig.sensorId, sensors.id));
  if (rows.length === 0) return { error: "No sensors to push to." };

  await db.transaction(async (tx) => {
    for (const row of rows) {
      // Box config wins over defaults for any key already set, EXCEPT the enable
      // flags + scope we explicitly want to turn on. So spread existing first,
      // then our defaults — turning the features on without clobbering tuning
      // (community, schedule interval, providers a box already customized).
      const existing = (row.config as Record<string, unknown>) ?? {};
      const merged = { ...existing, ...defaults };
      // Preserve a box's own custom speedtest provider list if it set one.
      if (typeof existing.speedtest_providers === "string" && existing.speedtest_providers) {
        merged.speedtest_providers = existing.speedtest_providers;
      }
      const nextV = (row.v ?? 0) + 1;
      await tx
        .insert(desiredConfig)
        .values({ sensorId: row.sensorId, configVersion: nextV, config: merged, updatedBy: admin.id })
        .onConflictDoUpdate({
          target: desiredConfig.sensorId,
          set: { configVersion: nextV, config: merged, updatedBy: admin.id, updatedAt: new Date() },
        });
    }
  });

  await audit(admin.email, "sensor_bulk_recommended_defaults", { count: rows.length });
  await adminEvent(admin.email, "fleet_recommended_defaults_pushed", { count: rows.length }, "low");
  revalidatePath(basePathFor(formData));
  return {
    ok: true,
    message: `Enabled SNMP spine crawl + speed tests on ${rows.length} sensor(s) — each applies on its next check-in. Set each district's SNMP community in settings if not already.`,
  };
}

// --- release channels / canary (#4) ----------------------------------------

/** Merge an update-channel patch into the given sensors' desired config + bump
 *  each version. Shared by the per-sensor + fleet release actions. */
async function pushChannel(
  patch: Record<string, unknown>,
  adminId: number,
  onlySensorId?: number,
): Promise<number> {
  const rows = await db
    .select({ sensorId: sensors.id, v: desiredConfig.configVersion, config: desiredConfig.config })
    .from(sensors)
    .leftJoin(desiredConfig, eq(desiredConfig.sensorId, sensors.id))
    .where(onlySensorId != null ? eq(sensors.id, onlySensorId) : undefined);
  await db.transaction(async (tx) => {
    for (const row of rows) {
      const merged = { ...((row.config as Record<string, unknown>) ?? {}), ...patch };
      const nextV = (row.v ?? 0) + 1;
      await tx
        .insert(desiredConfig)
        .values({ sensorId: row.sensorId, configVersion: nextV, config: merged, updatedBy: adminId })
        .onConflictDoUpdate({
          target: desiredConfig.sensorId,
          set: { configVersion: nextV, config: merged, updatedBy: adminId, updatedAt: new Date() },
        });
    }
  });
  return rows.length;
}

/** Set ONE sensor's update channel (the canary-cohort knob). For 'stable' the
 *  box pins to the current stableSha; 'canary' tracks main; 'hold' pauses. */
export async function setSensorChannelAction(
  _prev: SensorActionState,
  formData: FormData,
): Promise<SensorActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };
  const sensorId = Number(formData.get("sensorId"));
  if (!Number.isInteger(sensorId)) return { error: "Invalid sensor." };
  const channel = String(formData.get("channel") ?? "stable").toLowerCase();
  if (!["stable", "canary", "hold"].includes(channel)) return { error: "Bad channel." };

  const [rel] = await db.select({ sha: releaseSettings.stableSha }).from(releaseSettings).limit(1);
  const patch: Record<string, unknown> = { update_channel: channel };
  if (channel === "stable") patch.update_ref = rel?.sha ?? "";
  else if (channel === "canary") patch.update_ref = "";

  await pushChannel(patch, admin.id, sensorId);
  await audit(admin.email, "sensor_channel_set", { sensorId, channel });
  await adminEvent(admin.email, "sensor_channel_set", { sensorId, channel }, "medium", `sensor:${sensorId}`);
  revalidatePath(basePathFor(formData));
  return { ok: true, message: `Sensor set to '${channel}' — applies on its next check-in.` };
}

/** Promote/pin: set the global stable SHA and push it to EVERY sensor on the
 *  stable channel (update_channel=stable + update_ref=sha). The fleet converges
 *  to this validated release on each box's next check-in + nightly update. */
export async function pinStableReleaseAction(
  _prev: SensorActionState,
  formData: FormData,
): Promise<SensorActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };
  const sha = String(formData.get("stableSha") ?? "").trim();
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return { error: "Enter a valid git commit SHA (7–40 hex chars)." };
  const notes = String(formData.get("notes") ?? "").trim() || null;

  await db
    .insert(releaseSettings)
    .values({ id: 1, stableSha: sha, notes, updatedBy: admin.id })
    .onConflictDoUpdate({
      target: releaseSettings.id,
      set: { stableSha: sha, notes, updatedBy: admin.id, updatedAt: new Date() },
    });

  const count = await pushChannel({ update_channel: "stable", update_ref: sha }, admin.id);
  await audit(admin.email, "release_stable_pinned", { sha, count });
  await adminEvent(admin.email, "release_stable_pinned", { sha, count }, "medium");
  revalidatePath(basePathFor(formData));
  return {
    ok: true,
    message: `Pinned stable to ${sha.slice(0, 8)} and pushed to ${count} sensor(s) — each converges on its next update.`,
  };
}

/**
 * Open a live remote-console session (browser SSH-like) to a sensor. Mints two
 * opaque one-time tokens (operator + sensor; stored only as hashes) and a
 * recordKey for the zero-secret broker, queues an `open-console` command the
 * sensor picks up on its next check-in (and dials the broker), and returns the
 * operator's credentials so the browser can connect. Superadmin-only,
 * time-boxed (CONSOLE_TTL_MS), restricted-command, fully recorded.
 */
export async function openConsoleSessionAction(
  _prev: SensorActionState,
  formData: FormData,
): Promise<SensorActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };
  const sensorId = Number(formData.get("sensorId"));
  if (!Number.isInteger(sensorId)) return { error: "Invalid sensor." };

  const sid = randomBytes(16).toString("hex");
  const operatorToken = randomBytes(32).toString("hex");
  const sensorToken = randomBytes(32).toString("hex");
  const recordKey = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + CONSOLE_TTL_MS);

  // Queue the open-console command. 'approved' (not 'pending') because opening
  // the session IS the superadmin's authorization — it dispatches at next check-in.
  const [cmd] = await db
    .insert(commandQueue)
    .values({
      sensorId,
      command: "open-console",
      args: { sid, broker: BROKER_WSS_URL, token: sensorToken, expiresAt: expiresAt.getTime() },
      status: "approved",
      requiresApproval: false,
      approvedBy: admin.id,
      approvedAt: new Date(),
      createdBy: admin.id,
    })
    .returning({ id: commandQueue.id });

  await db.insert(shellSessions).values({
    id: sid,
    sensorId,
    status: "pending",
    operatorTokenHash: hashToken(operatorToken),
    sensorTokenHash: hashToken(sensorToken),
    recordKey,
    commandId: cmd?.id ?? null,
    openedBy: admin.id,
    openedByEmail: admin.email,
    expiresAt,
  });

  await audit(admin.email, "console_session_opened", { sensorId, sid });
  await adminEvent(
    admin.email,
    "console_session_opened",
    { sensorId, sid },
    "medium",
    `sensor:${sensorId}`,
  );
  revalidatePath(basePathFor(formData));
  return {
    ok: true,
    message: "Session opening — waiting for the sensor to connect on its next check-in.",
    session: { sid, operatorToken, broker: BROKER_WSS_URL, expiresAt: expiresAt.getTime() },
  };
}

/**
 * Extend a live console session's time-box by CONSOLE_TTL_MS (CON-6). Capped at
 * createdAt + CONSOLE_ABS_MAX_MS. Only bumps the DB `expiresAt`; the broker's
 * /alive poll picks up the new value within ~10s, re-arms its hard timer, and
 * pushes an `expiry` frame to both ends. Superadmin-only, audited.
 */
export async function extendConsoleSessionAction(
  _prev: SensorActionState,
  formData: FormData,
): Promise<SensorActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };
  const sid = String(formData.get("sid") ?? "").trim();
  if (!sid) return { error: "Invalid session." };

  const [s] = await db
    .select({
      status: shellSessions.status,
      sensorId: shellSessions.sensorId,
      createdAt: shellSessions.createdAt,
      expiresAt: shellSessions.expiresAt,
    })
    .from(shellSessions)
    .where(eq(shellSessions.id, sid))
    .limit(1);
  if (!s) return { error: "Session not found." };
  if (s.status === "closed" || s.status === "killed" || s.status === "expired") {
    return { error: "Session already ended." };
  }

  const absMax = s.createdAt.getTime() + CONSOLE_ABS_MAX_MS;
  // Extend from whichever is later — the current deadline or now — so extending
  // after a lull doesn't lose time, then clamp to the absolute ceiling.
  const proposed = Math.min(absMax, Math.max(s.expiresAt.getTime(), Date.now()) + CONSOLE_TTL_MS);
  if (proposed <= s.expiresAt.getTime()) {
    return { error: "Session is already at its maximum length (60 min)." };
  }

  await db
    .update(shellSessions)
    .set({ expiresAt: new Date(proposed) })
    .where(eq(shellSessions.id, sid));

  await audit(admin.email, "console_session_extended", { sid, sensorId: s.sensorId, expiresAt: proposed });
  await adminEvent(
    admin.email,
    "console_session_extended",
    { sid, sensorId: s.sensorId },
    "info",
    `sensor:${s.sensorId}`,
  );
  revalidatePath(basePathFor(formData));
  return { ok: true, message: "Session extended +15 min.", extendedExpiresAt: proposed };
}

/** Kill-switch: mark a console session killed. The broker's /alive poll drops the tunnel within ~10s. */
export async function killConsoleSessionAction(
  _prev: SensorActionState,
  formData: FormData,
): Promise<SensorActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };
  const sid = String(formData.get("sid") ?? "").trim();
  if (!sid) return { error: "Invalid session." };

  const [s] = await db
    .select({ status: shellSessions.status, sensorId: shellSessions.sensorId })
    .from(shellSessions)
    .where(eq(shellSessions.id, sid))
    .limit(1);
  if (!s) return { error: "Session not found." };

  if (s.status !== "closed" && s.status !== "expired" && s.status !== "killed") {
    await db
      .update(shellSessions)
      .set({ status: "killed", closedAt: new Date() })
      .where(eq(shellSessions.id, sid));
  }
  await audit(admin.email, "console_session_killed", { sid, sensorId: s.sensorId });
  await adminEvent(
    admin.email,
    "console_session_killed",
    { sid, sensorId: s.sensorId },
    "medium",
    `sensor:${s.sensorId}`,
  );
  revalidatePath(basePathFor(formData));
  return { ok: true, message: "Session killed." };
}
