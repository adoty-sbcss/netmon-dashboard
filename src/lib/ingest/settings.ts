/**
 * Read/write the singleton SFTP ingestion settings (ingest_settings, id = 1).
 *
 * Two read shapes:
 *   - getIngestSettingsView(): safe for the UI — booleans for "is a secret set",
 *     never the secret itself.
 *   - resolveSftpConfig(): decrypts the stored secrets into a connect-ready
 *     config for an actual sync. Falls back to SFTP_* env vars (the old
 *     deploy-time path) when no DB row is configured.
 *
 * Relative imports (not the @/ alias) so this module also loads under tsx in the
 * CLI sync job, not just inside Next.
 */
import { eq } from "drizzle-orm";

import { db } from "../../db";
import { ingestSettings } from "../../db/schema/app";
import { encryptSecret, decryptSecret } from "../crypto/secret-box";

export type AuthMode = "password" | "key";

/** Allowed scheduled-pull cadences and their interval in milliseconds. */
export const SCHEDULE_FREQUENCIES = {
  hourly: 60 * 60 * 1000,
  every6h: 6 * 60 * 60 * 1000,
  every12h: 12 * 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
} as const;

export type ScheduleFrequency = keyof typeof SCHEDULE_FREQUENCIES;

/** Human labels for the frequency selector. */
export const SCHEDULE_FREQUENCY_LABELS: Record<ScheduleFrequency, string> = {
  hourly: "Every hour",
  every6h: "Every 6 hours",
  every12h: "Every 12 hours",
  daily: "Once a day",
};

export function frequencyToMs(freq: string): number {
  return (
    SCHEDULE_FREQUENCIES[freq as ScheduleFrequency] ?? SCHEDULE_FREQUENCIES.every6h
  );
}

/** Connect-ready config (secrets decrypted). */
export interface SftpConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  baseDir: string;
}

/** UI-safe projection — no secret material, just whether each is present. */
export interface IngestSettingsView {
  configured: boolean;
  host: string;
  port: number;
  username: string;
  authMode: AuthMode;
  baseDir: string;
  enabled: boolean;
  scheduleEnabled: boolean;
  scheduleFrequency: ScheduleFrequency;
  hasPassword: boolean;
  hasPrivateKey: boolean;
  hasPassphrase: boolean;
  lastSyncAt: Date | null;
  lastSyncStatus: string | null;
  lastSyncSummary: string | null;
  updatedAt: Date | null;
}

const SINGLETON_ID = 1;

async function getRow() {
  const [row] = await db
    .select()
    .from(ingestSettings)
    .where(eq(ingestSettings.id, SINGLETON_ID))
    .limit(1);
  return row ?? null;
}

export async function getIngestSettingsView(): Promise<IngestSettingsView> {
  const row = await getRow();
  const hasSecret =
    (row?.authMode ?? "password") === "key" ? !!row?.privateKeyEnc : !!row?.passwordEnc;
  return {
    configured: !!(row?.host && row?.username && hasSecret),
    host: row?.host ?? "",
    port: row?.port ?? 22,
    username: row?.username ?? "",
    authMode: (row?.authMode as AuthMode) ?? "password",
    baseDir: row?.baseDir ?? "/",
    enabled: row?.enabled ?? false,
    scheduleEnabled: row?.scheduleEnabled ?? false,
    scheduleFrequency: (row?.scheduleFrequency as ScheduleFrequency) ?? "every6h",
    hasPassword: !!row?.passwordEnc,
    hasPrivateKey: !!row?.privateKeyEnc,
    hasPassphrase: !!row?.passphraseEnc,
    lastSyncAt: row?.lastSyncAt ?? null,
    lastSyncStatus: row?.lastSyncStatus ?? null,
    lastSyncSummary: row?.lastSyncSummary ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}

export interface SaveIngestSettingsInput {
  host: string;
  port: number;
  username: string;
  authMode: AuthMode;
  baseDir: string;
  enabled: boolean;
  scheduleEnabled: boolean;
  scheduleFrequency: ScheduleFrequency;
  /** Only set when the admin typed a new value; blank = leave existing. */
  newPassword?: string;
  newPrivateKey?: string;
  newPassphrase?: string;
  /** Explicitly remove the stored passphrase. */
  clearPassphrase?: boolean;
  updatedBy: number;
}

/** Upsert the singleton row. Secrets are encrypted here, only when provided. */
export async function saveIngestSettings(input: SaveIngestSettingsInput): Promise<void> {
  const set: Partial<typeof ingestSettings.$inferInsert> = {
    host: input.host || null,
    port: input.port,
    username: input.username || null,
    authMode: input.authMode,
    baseDir: input.baseDir || "/",
    enabled: input.enabled,
    scheduleEnabled: input.scheduleEnabled,
    scheduleFrequency: input.scheduleFrequency,
    updatedBy: input.updatedBy,
    updatedAt: new Date(),
  };
  if (input.newPassword) set.passwordEnc = encryptSecret(input.newPassword);
  if (input.newPrivateKey) set.privateKeyEnc = encryptSecret(input.newPrivateKey);
  if (input.newPassphrase) set.passphraseEnc = encryptSecret(input.newPassphrase);
  if (input.clearPassphrase) set.passphraseEnc = null;

  await db
    .insert(ingestSettings)
    .values({ id: SINGLETON_ID, ...set })
    .onConflictDoUpdate({ target: ingestSettings.id, set });
}

function resolveFromEnv(): SftpConfig | null {
  const host = process.env.SFTP_HOST;
  const username = process.env.SFTP_USER;
  const password = process.env.SFTP_PASSWORD || undefined;
  const privateKey = process.env.SFTP_PRIVATE_KEY || undefined;
  if (!host || !username || (!password && !privateKey)) return null;
  return {
    host,
    port: Number(process.env.SFTP_PORT) || 22,
    username,
    password,
    privateKey,
    passphrase: process.env.SFTP_PASSPHRASE || undefined,
    baseDir: process.env.SFTP_BASE_DIR || "/",
  };
}

export interface ResolvedConfig {
  /** The master enabled flag (DB) — env path is implicitly enabled. */
  enabled: boolean;
  /** Whether automatic scheduled pulls are on (env path: always on). */
  scheduleEnabled: boolean;
  /** Configured cadence for scheduled pulls. */
  scheduleFrequency: ScheduleFrequency;
  /** When the last pull ran, for the interval gate (null if never). */
  lastSyncAt: Date | null;
  /** Connect-ready config, or null if nothing usable is configured. */
  config: SftpConfig | null;
  source: "db" | "env" | "none";
}

/**
 * Resolve the SFTP config for a real sync: DB row first (decrypting secrets),
 * then SFTP_* env vars as a fallback. Returns config=null when unconfigured.
 */
export async function resolveSftpConfig(): Promise<ResolvedConfig> {
  const row = await getRow();
  if (row && row.host && row.username) {
    const config: SftpConfig = {
      host: row.host,
      port: row.port,
      username: row.username,
      baseDir: row.baseDir,
    };
    if (row.authMode === "key") {
      if (row.privateKeyEnc) config.privateKey = decryptSecret(row.privateKeyEnc);
      if (row.passphraseEnc) config.passphrase = decryptSecret(row.passphraseEnc);
    } else if (row.passwordEnc) {
      config.password = decryptSecret(row.passwordEnc);
    }
    const hasSecret = !!(config.password || config.privateKey);
    return {
      enabled: row.enabled,
      scheduleEnabled: row.scheduleEnabled,
      scheduleFrequency: (row.scheduleFrequency as ScheduleFrequency) ?? "every6h",
      lastSyncAt: row.lastSyncAt ?? null,
      config: hasSecret ? config : null,
      source: "db",
    };
  }
  const env = resolveFromEnv();
  if (env) {
    return {
      enabled: true,
      scheduleEnabled: true,
      scheduleFrequency: "every6h",
      lastSyncAt: null,
      config: env,
      source: "env",
    };
  }
  return {
    enabled: false,
    scheduleEnabled: false,
    scheduleFrequency: "every6h",
    lastSyncAt: null,
    config: null,
    source: "none",
  };
}

/** Record that a sync run has begun (best-effort; no-op if no row). */
export async function markSyncStart(): Promise<void> {
  await db
    .update(ingestSettings)
    .set({ lastSyncStatus: "running", lastSyncAt: new Date() })
    .where(eq(ingestSettings.id, SINGLETON_ID));
}

/** Record the outcome of a sync run. */
export async function markSyncResult(
  status: "ok" | "error",
  summary: string,
): Promise<void> {
  await db
    .update(ingestSettings)
    .set({ lastSyncStatus: status, lastSyncSummary: summary, lastSyncAt: new Date() })
    .where(eq(ingestSettings.id, SINGLETON_ID));
}
