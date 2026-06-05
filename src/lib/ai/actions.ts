"use server";

/**
 * Server actions for AI analysis. Auth: the requester must have access to the
 * district (same scope rule as viewing it). The "Run analysis" action uses the
 * write-row-then-poll model — it inserts 'running' rows, kicks the heavy work
 * into next/server after() (which keeps the scale-to-zero container alive until
 * it finishes), and returns the runId immediately so the page can poll.
 */
import { after } from "next/server";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { auditLog } from "@/db/schema/app";
import { getDistrictBySlug, getSchoolBySlug } from "@/db/queries";
import { getSessionUser } from "@/lib/auth/current-user";
import { getUserScope, scopeAllowsDistrict } from "@/lib/auth/scope";
import { prepareRun, executeRun, type RunRequest } from "./orchestrator";
import { activeProviders, getProvider } from "./providers/registry";
import {
  resolveProviderConfig,
  saveProviderSettings,
  saveAiSettings,
  saveAssistantAvatar,
  clearAssistantAvatar,
} from "./settings";
import { getRun, type AnalysisRun } from "./queries";

const AI_SETTINGS_PATH = "/settings/ai";

export interface AiSettingsActionState {
  ok?: boolean;
  error?: string;
  message?: string;
}

async function requireSuperadmin() {
  const user = await getSessionUser();
  if (!user || user.role !== "superadmin") return null;
  return user;
}

async function audit(
  actor: string,
  action: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await db
    .insert(auditLog)
    .values({ actorType: "user", actor, action, detail })
    .catch(() => {});
}

const ANALYSIS_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface StartAnalysisResult {
  ok?: boolean;
  runId?: string;
  error?: string;
}

/** Kick off a district-wide analysis. Returns the runId to poll. */
export async function startDistrictAnalysis(
  districtSlug: string,
): Promise<StartAnalysisResult> {
  const user = await getSessionUser();
  if (!user) return { error: "Not authenticated." };

  const district = await getDistrictBySlug(districtSlug);
  if (!district) return { error: "District not found." };

  const scope = await getUserScope(user);
  if (!scopeAllowsDistrict(scope, district.id)) {
    return { error: "Not authorized for this district." };
  }

  if ((await activeProviders()).length === 0) {
    return {
      error:
        "No AI provider is enabled yet. Configure one in Settings → AI analysis.",
    };
  }

  const now = new Date();
  const req: RunRequest = {
    scope: {
      type: "district",
      id: district.id,
      districtId: district.id,
      label: district.name || district.slug,
    },
    window: { start: new Date(now.getTime() - ANALYSIS_WINDOW_MS), end: now },
    trigger: "manual",
    requestedBy: user.id,
  };

  const { runId } = await prepareRun(req);

  // Finish after the response is sent; keeps the container alive until done.
  after(async () => {
    await executeRun(runId, req);
  });

  await db
    .insert(auditLog)
    .values({
      actorType: "user",
      actor: user.email,
      action: "ai_analysis_run",
      target: `district:${district.slug}`,
      detail: { runId, trigger: "manual" },
    })
    .catch(() => {});

  return { ok: true, runId };
}

/** Kick off a school-scoped analysis (just that school's data). Returns the runId. */
export async function startSchoolAnalysis(
  districtSlug: string,
  schoolSlug: string,
): Promise<StartAnalysisResult> {
  const user = await getSessionUser();
  if (!user) return { error: "Not authenticated." };

  const district = await getDistrictBySlug(districtSlug);
  if (!district) return { error: "District not found." };

  const scope = await getUserScope(user);
  if (!scopeAllowsDistrict(scope, district.id)) {
    return { error: "Not authorized for this district." };
  }

  const school = await getSchoolBySlug(district.id, schoolSlug);
  if (!school) return { error: "School not found." };

  if ((await activeProviders()).length === 0) {
    return {
      error:
        "No AI provider is enabled yet. Configure one in Settings → AI analysis.",
    };
  }

  const now = new Date();
  const req: RunRequest = {
    scope: {
      type: "school",
      id: school.id,
      districtId: district.id,
      label: `${district.name || district.slug} — ${school.name || school.slug}`,
    },
    window: { start: new Date(now.getTime() - ANALYSIS_WINDOW_MS), end: now },
    trigger: "manual",
    requestedBy: user.id,
  };

  const { runId } = await prepareRun(req);
  after(async () => {
    await executeRun(runId, req);
  });

  await db
    .insert(auditLog)
    .values({
      actorType: "user",
      actor: user.email,
      action: "ai_analysis_run",
      target: `school:${district.slug}/${school.slug}`,
      detail: { runId, trigger: "manual" },
    })
    .catch(() => {});

  return { ok: true, runId };
}

/** Poll a run's status + results. Scope-checked against the requester. */
export async function getRunStatus(
  runId: string,
): Promise<{ run?: AnalysisRun; error?: string }> {
  const user = await getSessionUser();
  if (!user) return { error: "Not authenticated." };

  const run = await getRun(runId);
  if (!run) return { error: "Run not found." };

  const scope = await getUserScope(user);
  if (!scopeAllowsDistrict(scope, run.districtId)) {
    return { error: "Not authorized for this run." };
  }

  return { run };
}

// ---------------------------------------------------------------------------
// Settings (superadmin) — /settings/ai
// ---------------------------------------------------------------------------

/** Save one provider's config. Encrypts a newly-entered key; blank keeps it. */
export async function saveProviderAction(
  _prev: AiSettingsActionState,
  formData: FormData,
): Promise<AiSettingsActionState> {
  const user = await requireSuperadmin();
  if (!user) return { error: "Not authorized." };

  const providerId = String(formData.get("providerId") ?? "");
  if (!getProvider(providerId)) return { error: "Unknown provider." };

  await saveProviderSettings({
    providerId,
    enabled: formData.get("enabled") === "on",
    model: String(formData.get("model") ?? "").trim() || undefined,
    endpoint: String(formData.get("endpoint") ?? "").trim() || undefined,
    apiVersion: String(formData.get("apiVersion") ?? "").trim() || undefined,
    organization: String(formData.get("organization") ?? "").trim() || undefined,
    project: String(formData.get("project") ?? "").trim() || undefined,
    newApiKey: String(formData.get("newApiKey") ?? ""),
    clearApiKey: formData.get("clearApiKey") === "on",
    updatedBy: user.id,
  });
  await audit(user.email, "ai_provider_settings_saved", { providerId });
  revalidatePath(AI_SETTINGS_PATH);
  return { ok: true, message: "Saved." };
}

/** Validate a provider's credentials with a tiny live call. */
export async function testProviderAction(
  _prev: AiSettingsActionState,
  formData: FormData,
): Promise<AiSettingsActionState> {
  const user = await requireSuperadmin();
  if (!user) return { error: "Not authorized." };

  const providerId = String(formData.get("providerId") ?? "");
  const provider = getProvider(providerId);
  if (!provider) return { error: "Unknown provider." };

  const config = await resolveProviderConfig(providerId);
  if (!provider.isConfigured(config)) {
    return { error: "Missing API key or model — save those first." };
  }

  try {
    const result = await provider.analyze(
      {
        scope: { type: "district", id: 0, districtId: 0, label: "connection test" },
        window: { start: new Date(), end: new Date() },
        instructions:
          "Connection test. Return an empty findings array and a one-word summary.",
        context: "{}",
      },
      config,
      { maxOutputTokens: 256 },
    );
    await audit(user.email, "ai_provider_test", { providerId, ok: true });
    return {
      ok: true,
      message: `Connected — ${result.model} responded in ${(result.latencyMs / 1000).toFixed(1)}s.`,
    };
  } catch (err) {
    await audit(user.email, "ai_provider_test", {
      providerId,
      ok: false,
      error: (err as Error).message,
    });
    return { error: `Test failed: ${(err as Error).message}` };
  }
}

/** Save global AI settings (schedule, token bound, advisory cap). */
export async function saveAiSettingsAction(
  _prev: AiSettingsActionState,
  formData: FormData,
): Promise<AiSettingsActionState> {
  const user = await requireSuperadmin();
  if (!user) return { error: "Not authorized." };

  const maxTokens = Number(formData.get("maxOutputTokens"));
  const capRaw = String(formData.get("monthlySpendCapUsd") ?? "").trim();
  const cap = capRaw === "" ? null : Number(capRaw);
  if (capRaw !== "" && (Number.isNaN(cap as number) || (cap as number) < 0)) {
    return { error: "Monthly cap must be a non-negative number." };
  }
  const instr = String(formData.get("assistantInstructions") ?? "").trim();
  const name = String(formData.get("assistantName") ?? "").trim();

  await saveAiSettings(
    {
      scheduleEnabled: formData.get("scheduleEnabled") === "on",
      scheduleCron: String(formData.get("scheduleCron") ?? "0 2 * * *").trim() || "0 2 * * *",
      maxOutputTokens:
        Number.isFinite(maxTokens) && maxTokens >= 256 ? Math.floor(maxTokens) : 8192,
      monthlySpendCapUsd: cap,
      assistantInstructions: instr ? instr.slice(0, 8000) : null,
      assistantName: name ? name.slice(0, 80) : null,
    },
    user.id,
  );
  await audit(user.email, "ai_settings_saved", {});
  revalidatePath(AI_SETTINGS_PATH);
  return { ok: true, message: "Settings saved." };
}

// ---- assistant avatar upload (base64 in DB, mirrors branding) --------------

const AVATAR_MAX_BYTES = 512 * 1024; // 512 KB
const AVATAR_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
  "image/gif",
]);

export async function uploadAssistantAvatarAction(
  _prev: AiSettingsActionState,
  formData: FormData,
): Promise<AiSettingsActionState> {
  const user = await requireSuperadmin();
  if (!user) return { error: "Not authorized." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image first." };
  if (file.size > AVATAR_MAX_BYTES) return { error: "Image too large (max 512 KB)." };
  if (!AVATAR_TYPES.has(file.type)) {
    return {
      error: `Unsupported type${file.type ? ` (${file.type})` : ""}. Use PNG, JPEG, WEBP, GIF, or SVG.`,
    };
  }

  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  await saveAssistantAvatar(file.type, base64, user.id);
  await audit(user.email, "ai_avatar_uploaded", { mime: file.type });
  revalidatePath(AI_SETTINGS_PATH);
  revalidatePath("/", "layout");
  return { ok: true, message: "Assistant picture updated." };
}

export async function clearAssistantAvatarAction(
  _prev: AiSettingsActionState,
  _formData: FormData,
): Promise<AiSettingsActionState> {
  void _prev;
  void _formData;
  const user = await requireSuperadmin();
  if (!user) return { error: "Not authorized." };
  await clearAssistantAvatar(user.id);
  await audit(user.email, "ai_avatar_cleared", {});
  revalidatePath(AI_SETTINGS_PATH);
  revalidatePath("/", "layout");
  return { ok: true, message: "Assistant picture removed — using the default." };
}
