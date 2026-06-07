/**
 * Global security analysis runner — the security counterpart to orchestrator.ts.
 * Builds ONE provider-agnostic input from the security_events snapshot and fans
 * it out to every active model, writing one security_analyses row per model
 * (shared runId). No district scope (the events are global); no issues
 * reconciliation (findings render straight on the superadmin Security page).
 *
 * Relative imports + no `server-only` so the cron Job can import this under tsx.
 */
import { randomUUID } from "node:crypto";
import { and, eq, gte, lte, isNull } from "drizzle-orm";

import { db } from "../../db";
import { securityAnalyses } from "../../db/schema/ai";
import { securityEvents } from "../../db/schema/app";
import { activeProviders } from "./providers/registry";
import { getAiSettings } from "./settings";
import { estimateCost } from "./pricing";
import { schedule, noteRateLimit, retryAfterSeconds } from "./limiter";
import { getSecurityInstructions } from "./security-instructions";
import { buildSecurityContext, countSecurityEvents } from "./security-context";
import type { AnalysisWindow } from "./types";

export interface SecurityRunRequest {
  window: AnalysisWindow;
  trigger: "scheduled" | "manual";
  requestedBy?: number | null;
}

// analyze() reads only instructions + context, so the scope is a label-only
// placeholder (mirrors testProviderAction's throwaway scope). Never stored.
const SCOPE = {
  type: "district" as const,
  id: 0,
  districtId: 0,
  label: "NetMon Dashboard — global security",
};

/** Insert one 'running' row per active provider. Returns the runId for polling. */
export async function prepareSecurityRun(
  req: SecurityRunRequest,
): Promise<{ runId: string | null; providerIds: string[] }> {
  const active = await activeProviders();
  if (active.length === 0) return { runId: null, providerIds: [] };

  const runId = randomUUID();
  await db.insert(securityAnalyses).values(
    active.map(({ provider }) => ({
      runId,
      windowStart: req.window.start,
      windowEnd: req.window.end,
      trigger: req.trigger,
      providerId: provider.id,
      status: "running" as const,
      requestedBy: req.requestedBy ?? null,
    })),
  );
  return { runId, providerIds: active.map(({ provider }) => provider.id) };
}

/** Build the security context, run every active provider, update each row. */
export async function executeSecurityRun(
  runId: string,
  req: SecurityRunRequest,
): Promise<void> {
  const active = await activeProviders();
  if (active.length === 0) return;

  const settings = await getAiSettings();
  const { context, eventCount } = await buildSecurityContext(req.window);

  // Stamp the event count onto this run's rows now that it's known.
  await db
    .update(securityAnalyses)
    .set({ eventCount })
    .where(eq(securityAnalyses.runId, runId));

  const input = {
    scope: SCOPE,
    window: req.window,
    instructions: getSecurityInstructions(),
    context,
  };
  const opts = { maxOutputTokens: settings.maxOutputTokens };

  await Promise.all(
    active.map(async ({ provider, config }) => {
      try {
        const result = await schedule(() => provider.analyze(input, config, opts));
        await db
          .update(securityAnalyses)
          .set({
            status: "ok",
            model: result.model,
            prose: result.prose,
            findings: result.findings,
            tokensIn: result.tokensIn,
            tokensOut: result.tokensOut,
            costUsd: estimateCost(result.model, result.tokensIn, result.tokensOut),
            latencyMs: result.latencyMs,
            completedAt: new Date(),
          })
          .where(and(eq(securityAnalyses.runId, runId), eq(securityAnalyses.providerId, provider.id)));
      } catch (err) {
        const ra = retryAfterSeconds(err);
        if (ra) noteRateLimit(ra);
        await db
          .update(securityAnalyses)
          .set({
            status: "failed",
            error: (err as Error).message?.slice(0, 2000) ?? "unknown error",
            completedAt: new Date(),
          })
          .where(and(eq(securityAnalyses.runId, runId), eq(securityAnalyses.providerId, provider.id)));
      }
    }),
  );

  // Mark the reviewed events so the UI can show "N new since last analysis".
  try {
    await db
      .update(securityEvents)
      .set({ analyzedAt: new Date() })
      .where(
        and(
          gte(securityEvents.at, req.window.start),
          lte(securityEvents.at, req.window.end),
          isNull(securityEvents.analyzedAt),
        ),
      );
  } catch {
    // non-fatal — the analysis already succeeded
  }
}

/**
 * Scheduled convenience: skip entirely when no events occurred in the window
 * (don't spend tokens on an empty day), otherwise prepare + execute, awaited.
 */
export async function runSecurityAnalysis(
  req: SecurityRunRequest,
): Promise<{ runId: string | null; eventCount: number }> {
  const active = await activeProviders();
  if (active.length === 0) return { runId: null, eventCount: 0 };

  const eventCount = await countSecurityEvents(req.window);
  if (eventCount === 0) return { runId: null, eventCount: 0 };

  const { runId } = await prepareSecurityRun(req);
  if (runId) await executeSecurityRun(runId, req);
  return { runId, eventCount };
}
