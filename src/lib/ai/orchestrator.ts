/**
 * Orchestration: turn one analysis request into N stored ai_analyses rows (one
 * per ACTIVE model — enabled + configured), all sharing a runId.
 *
 *  - runAnalysis(): prepare + execute, fully awaited. Used by the daily cron Job.
 *  - prepareRun() + executeRun(): the web button inserts 'running' rows first
 *    (so the page can poll immediately) and finishes the work in next/server
 *    after(), which keeps the scale-to-zero container alive until it's done.
 *
 * The provider-agnostic AnalysisInput (context + instructions) is built ONCE and
 * handed to every provider, so the model columns are strictly comparable. Each
 * row also records token usage + an estimated cost (see pricing.ts).
 *
 * Relative imports + no `server-only` so the cron Job can import this under tsx.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { db } from "../../db";
import { aiAnalyses } from "../../db/schema/ai";
import { buildAnalysisContext } from "./context";
import { getAnalystInstructions } from "./instructions";
import { activeProviders } from "./providers/registry";
import { getAiSettings } from "./settings";
import { estimateCost } from "./pricing";
import type { AnalysisScope, AnalysisWindow } from "./types";

export interface RunRequest {
  scope: AnalysisScope;
  window: AnalysisWindow;
  trigger: "scheduled" | "manual";
  requestedBy?: number | null;
}

/**
 * Insert one 'running' row per active provider and return the runId. Call this
 * synchronously in the request path so the UI can poll right away. Returns an
 * empty providerIds list (still a runId) when no provider is active.
 */
export async function prepareRun(req: RunRequest): Promise<{
  runId: string;
  providerIds: string[];
}> {
  const runId = randomUUID();
  const active = await activeProviders();
  if (active.length === 0) return { runId, providerIds: [] };

  await db.insert(aiAnalyses).values(
    active.map(({ provider }) => ({
      runId,
      scopeType: req.scope.type,
      scopeId: req.scope.id,
      districtId: req.scope.districtId,
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

/**
 * Run every active provider for an already-prepared run and update its row.
 * Builds the shared input once; each provider's success/failure is independent.
 */
export async function executeRun(runId: string, req: RunRequest): Promise<void> {
  const active = await activeProviders();
  if (active.length === 0) return;

  const settings = await getAiSettings();
  const context = await buildAnalysisContext(req.scope, req.window);
  const input = {
    scope: req.scope,
    window: req.window,
    instructions: getAnalystInstructions(),
    context,
  };
  const opts = { maxOutputTokens: settings.maxOutputTokens };

  await Promise.all(
    active.map(async ({ provider, config }) => {
      try {
        const result = await provider.analyze(input, config, opts);
        await db
          .update(aiAnalyses)
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
          .where(
            and(
              eq(aiAnalyses.runId, runId),
              eq(aiAnalyses.providerId, provider.id),
            ),
          );
      } catch (err) {
        await db
          .update(aiAnalyses)
          .set({
            status: "failed",
            error: (err as Error).message?.slice(0, 2000) ?? "unknown error",
            completedAt: new Date(),
          })
          .where(
            and(
              eq(aiAnalyses.runId, runId),
              eq(aiAnalyses.providerId, provider.id),
            ),
          );
      }
    }),
  );
}

/** Prepare + execute, fully awaited. For the daily cron Job. */
export async function runAnalysis(req: RunRequest): Promise<string> {
  const { runId, providerIds } = await prepareRun(req);
  if (providerIds.length > 0) await executeRun(runId, req);
  return runId;
}
