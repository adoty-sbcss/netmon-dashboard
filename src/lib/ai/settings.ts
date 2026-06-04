/**
 * Read/write AI configuration: per-provider settings (ai_provider_settings) and
 * the global singleton (ai_settings, id = 1).
 *
 *   resolveProviderConfig()  decrypts the key into a connect-ready config for a
 *                            real call. DB is primary; env vars are a fallback
 *                            (the deploy-time path). Mirrors resolveSftpConfig.
 *   getProviderSettingsView() UI-safe: never the key, just whether one is set.
 *   saveProviderSettings()   upsert; encrypts a new key, keeps the old on blank.
 *
 * Relative imports + no `server-only` so this also loads under tsx in the AI cron
 * Job, exactly like src/lib/ingest/settings.ts.
 */
import { eq } from "drizzle-orm";

import { db } from "../../db";
import { aiProviderSettings, aiSettings } from "../../db/schema/ai";
import { encryptSecret, decryptSecret } from "../crypto/secret-box";
import type { ResolvedProviderConfig } from "./types";

export const AI_PROVIDER_IDS = ["azure-openai", "openai", "anthropic"] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

const SINGLETON_ID = 1;

const DEFAULTS = {
  scheduleEnabled: true,
  scheduleCron: "0 2 * * *",
  // Kept modest on purpose: Azure OpenAI reserves this against the deployment's
  // TPM quota at admission, so a large value makes every call costlier to the
  // rate limit. Raise it per-install in Settings → AI if reports get truncated.
  maxOutputTokens: 2048,
  monthlySpendCapUsd: null as number | null,
};

// ---- env fallback ---------------------------------------------------------

/** Provider config sourced from env vars (used when no DB row / field is set). */
function envConfig(providerId: string): Partial<ResolvedProviderConfig> {
  const e = process.env;
  switch (providerId) {
    case "azure-openai":
      return {
        apiKey: e.AZURE_OPENAI_API_KEY,
        endpoint: e.AZURE_OPENAI_ENDPOINT,
        model: e.AZURE_OPENAI_DEPLOYMENT,
        apiVersion: e.AZURE_OPENAI_API_VERSION,
      };
    case "openai":
      return {
        apiKey: e.OPENAI_API_KEY,
        model: e.OPENAI_MODEL,
        organization: e.OPENAI_ORGANIZATION,
        project: e.OPENAI_PROJECT,
      };
    case "anthropic":
      return { apiKey: e.ANTHROPIC_API_KEY, model: e.ANTHROPIC_MODEL };
    default:
      return {};
  }
}

// ---- resolve (decrypted, for real calls) ----------------------------------

async function getProviderRow(providerId: string) {
  const [row] = await db
    .select()
    .from(aiProviderSettings)
    .where(eq(aiProviderSettings.providerId, providerId))
    .limit(1);
  return row ?? null;
}

export async function resolveProviderConfig(
  providerId: string,
): Promise<ResolvedProviderConfig> {
  const row = await getProviderRow(providerId);
  const env = envConfig(providerId);

  let apiKey = env.apiKey;
  if (row?.apiKeyEnc) {
    try {
      apiKey = decryptSecret(row.apiKeyEnc);
    } catch {
      // Corrupt/rotated AUTH_SECRET — fall back to env rather than crash.
    }
  }

  // No DB row yet → enabled iff env supplies a key (preserves env-only deploys).
  const enabled = row ? row.enabled : Boolean(env.apiKey);

  const pick = (a?: string | null, b?: string | null) =>
    (a && a.length > 0 ? a : b) || undefined;

  return {
    providerId,
    enabled,
    apiKey: apiKey || undefined,
    model: pick(row?.model, env.model),
    endpoint: pick(row?.endpoint, env.endpoint),
    apiVersion: pick(row?.apiVersion, env.apiVersion),
    organization: pick(row?.organization, env.organization),
    project: pick(row?.project, env.project),
  };
}

export async function resolveAllProviderConfigs(): Promise<
  Record<string, ResolvedProviderConfig>
> {
  const out: Record<string, ResolvedProviderConfig> = {};
  for (const id of AI_PROVIDER_IDS) {
    out[id] = await resolveProviderConfig(id);
  }
  return out;
}

// ---- UI-safe views --------------------------------------------------------

export interface AiProviderSettingsView {
  providerId: string;
  enabled: boolean;
  model: string;
  endpoint: string;
  apiVersion: string;
  organization: string;
  project: string;
  /** A key is available (from DB or env). */
  hasKey: boolean;
  /** The only key available is from env (no DB-stored key). */
  keyFromEnv: boolean;
  updatedAt: Date | null;
}

export async function getProviderSettingsView(
  providerId: string,
): Promise<AiProviderSettingsView> {
  const row = await getProviderRow(providerId);
  const env = envConfig(providerId);
  const hasDbKey = Boolean(row?.apiKeyEnc);
  const hasEnvKey = Boolean(env.apiKey);
  return {
    providerId,
    enabled: row ? row.enabled : hasEnvKey,
    model: row?.model ?? env.model ?? "",
    endpoint: row?.endpoint ?? env.endpoint ?? "",
    apiVersion: row?.apiVersion ?? env.apiVersion ?? "",
    organization: row?.organization ?? env.organization ?? "",
    project: row?.project ?? env.project ?? "",
    hasKey: hasDbKey || hasEnvKey,
    keyFromEnv: !hasDbKey && hasEnvKey,
    updatedAt: row?.updatedAt ?? null,
  };
}

export interface AiGlobalSettings {
  scheduleEnabled: boolean;
  scheduleCron: string;
  maxOutputTokens: number;
  monthlySpendCapUsd: number | null;
  updatedAt: Date | null;
}

export async function getAiSettings(): Promise<AiGlobalSettings> {
  const [row] = await db
    .select()
    .from(aiSettings)
    .where(eq(aiSettings.id, SINGLETON_ID))
    .limit(1);
  if (!row) return { ...DEFAULTS, updatedAt: null };
  return {
    scheduleEnabled: row.scheduleEnabled,
    scheduleCron: row.scheduleCron,
    maxOutputTokens: row.maxOutputTokens,
    monthlySpendCapUsd: row.monthlySpendCapUsd,
    updatedAt: row.updatedAt,
  };
}

// ---- writes ---------------------------------------------------------------

export interface SaveProviderInput {
  providerId: string;
  enabled: boolean;
  model?: string;
  endpoint?: string;
  apiVersion?: string;
  organization?: string;
  project?: string;
  /** New plaintext key to encrypt. Omit/blank to keep the existing one. */
  newApiKey?: string;
  /** Explicitly remove the stored key. */
  clearApiKey?: boolean;
  updatedBy?: number | null;
}

export async function saveProviderSettings(input: SaveProviderInput): Promise<void> {
  const apiKeyEnc =
    input.clearApiKey
      ? null
      : input.newApiKey && input.newApiKey.length > 0
        ? encryptSecret(input.newApiKey)
        : undefined; // undefined = leave column untouched on update

  const base = {
    enabled: input.enabled,
    model: input.model || null,
    endpoint: input.endpoint || null,
    apiVersion: input.apiVersion || null,
    organization: input.organization || null,
    project: input.project || null,
    updatedBy: input.updatedBy ?? null,
    updatedAt: new Date(),
  };

  // Insert path needs the key column too (defaults to null when unchanged).
  await db
    .insert(aiProviderSettings)
    .values({
      providerId: input.providerId,
      apiKeyEnc: apiKeyEnc ?? null,
      ...base,
    })
    .onConflictDoUpdate({
      target: aiProviderSettings.providerId,
      set: apiKeyEnc === undefined ? base : { ...base, apiKeyEnc },
    });
}

export async function saveAiSettings(
  patch: Partial<Omit<AiGlobalSettings, "updatedAt">>,
  updatedBy?: number | null,
): Promise<void> {
  const current = await getAiSettings();
  const merged = { ...DEFAULTS, ...current, ...patch };
  await db
    .insert(aiSettings)
    .values({
      id: SINGLETON_ID,
      scheduleEnabled: merged.scheduleEnabled,
      scheduleCron: merged.scheduleCron,
      maxOutputTokens: merged.maxOutputTokens,
      monthlySpendCapUsd: merged.monthlySpendCapUsd,
      updatedBy: updatedBy ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: aiSettings.id,
      set: {
        scheduleEnabled: merged.scheduleEnabled,
        scheduleCron: merged.scheduleCron,
        maxOutputTokens: merged.maxOutputTokens,
        monthlySpendCapUsd: merged.monthlySpendCapUsd,
        updatedBy: updatedBy ?? null,
        updatedAt: new Date(),
      },
    });
}
