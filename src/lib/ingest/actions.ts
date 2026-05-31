"use server";

/**
 * Admin server actions for SFTP ingestion settings. All are superadmin-gated and
 * audit-logged. They run in the Node server runtime (they touch ssh2 + the DB).
 *
 *   saveSettingsAction    persist the connection (encrypting any new secrets)
 *   testConnectionAction  open an SFTP session against the SAVED config + list
 *   syncNowAction         run one sync pass inline and report the summary
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Client from "ssh2-sftp-client";

import { db } from "@/db";
import { auditLog } from "@/db/schema/app";
import { getSessionUser } from "@/lib/auth/current-user";
import {
  saveIngestSettings,
  resolveSftpConfig,
  markSyncStart,
  markSyncResult,
  type AuthMode,
} from "./settings";
import { runSync } from "@/ingest/sync-core";

const SETTINGS_PATH = "/settings/ingestion";

export interface SettingsActionState {
  error?: string;
  ok?: boolean;
  message?: string;
  log?: string[];
}

async function requireAdmin() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user.role === "superadmin" ? user : null;
}

async function audit(
  actor: string,
  action: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db.insert(auditLog).values({ actorType: "user", actor, action, detail });
  } catch {
    // best-effort
  }
}

export async function saveSettingsAction(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const user = await requireAdmin();
  if (!user) return { error: "Not authorized." };

  const host = String(formData.get("host") ?? "").trim();
  const username = String(formData.get("username") ?? "").trim();
  const authMode = (String(formData.get("authMode") ?? "password") as AuthMode);
  const baseDir = String(formData.get("baseDir") ?? "/").trim() || "/";
  const portRaw = String(formData.get("port") ?? "22").trim();
  const port = Number(portRaw) || 22;
  const enabled = formData.get("enabled") === "on";
  const newPassword = String(formData.get("newPassword") ?? "");
  const newPrivateKey = String(formData.get("newPrivateKey") ?? "");
  const newPassphrase = String(formData.get("newPassphrase") ?? "");
  const clearPassphrase = formData.get("clearPassphrase") === "on";

  if (enabled && (!host || !username)) {
    return { error: "Host and username are required to enable ingestion." };
  }
  if (port < 1 || port > 65535) {
    return { error: "Port must be between 1 and 65535." };
  }

  await saveIngestSettings({
    host,
    port,
    username,
    authMode,
    baseDir,
    enabled,
    newPassword: newPassword || undefined,
    newPrivateKey: newPrivateKey || undefined,
    newPassphrase: newPassphrase || undefined,
    clearPassphrase,
    updatedBy: user.id,
  });
  await audit(user.email, "ingest_settings_saved", {
    host,
    port,
    username,
    authMode,
    enabled,
  });

  revalidatePath(SETTINGS_PATH);
  return { ok: true, message: "Settings saved." };
}

export async function testConnectionAction(
  _prev: SettingsActionState,
  _formData: FormData,
): Promise<SettingsActionState> {
  const user = await requireAdmin();
  if (!user) return { error: "Not authorized." };

  const { config } = await resolveSftpConfig();
  if (!config) {
    return { error: "Save a host, username, and a password or key first." };
  }

  const sftp = new Client();
  try {
    await sftp.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      privateKey: config.privateKey,
      passphrase: config.passphrase,
      readyTimeout: 15000,
    });
    const entries = await sftp.list(config.baseDir).catch(() => []);
    const zips = entries.filter(
      (e) => e.type === "-" && e.name.toLowerCase().endsWith(".zip"),
    ).length;
    await audit(user.email, "ingest_test_connection", { host: config.host, ok: true });
    return {
      ok: true,
      message: `Connected to ${config.host}:${config.port}. Listed ${entries.length} item(s) in ${config.baseDir} (${zips} zip at top level).`,
    };
  } catch (err) {
    await audit(user.email, "ingest_test_connection", {
      host: config.host,
      ok: false,
      error: (err as Error).message,
    });
    return { error: `Connection failed: ${(err as Error).message}` };
  } finally {
    await sftp.end().catch(() => {});
  }
}

export async function syncNowAction(
  _prev: SettingsActionState,
  _formData: FormData,
): Promise<SettingsActionState> {
  const user = await requireAdmin();
  if (!user) return { error: "Not authorized." };

  const { config } = await resolveSftpConfig();
  if (!config) {
    return { error: "Save a host, username, and a password or key first." };
  }

  const log: string[] = [];
  await markSyncStart();
  try {
    const summary = await runSync(config, {}, (line) => log.push(line));
    const summaryLine = `found=${summary.found} new=${summary.new} ingested=${summary.ingested} skipped=${summary.skipped} failed=${summary.failed}`;
    await markSyncResult(summary.failed > 0 ? "error" : "ok", summaryLine);
    await audit(user.email, "ingest_sync_now", { ...summary });
    revalidatePath(SETTINGS_PATH);
    return {
      ok: summary.failed === 0,
      message:
        summary.failed > 0
          ? `Sync finished with ${summary.failed} failure(s). Ingested ${summary.ingested}.`
          : `Sync complete: ingested ${summary.ingested}, skipped ${summary.skipped} (of ${summary.found} found).`,
      log,
    };
  } catch (err) {
    await markSyncResult("error", (err as Error).message).catch(() => {});
    await audit(user.email, "ingest_sync_now", { error: (err as Error).message });
    revalidatePath(SETTINGS_PATH);
    return { error: `Sync failed: ${(err as Error).message}`, log };
  }
}
