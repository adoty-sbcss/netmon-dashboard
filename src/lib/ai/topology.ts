/**
 * Topology-analysis orchestrator. Mirrors orchestrator.ts (prepare 'running'
 * rows, then run every active provider and update each row) but with kind=
 * 'topology', the physical-topology context, and the architect instructions.
 * No `server-only` so it can run under a server action's after() and (later) a job.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { db } from "../../db";
import { aiAnalyses, type AiFinding } from "../../db/schema/ai";
import { reconcileIssues } from "../issues/reconcile";
import { activeProviders } from "./providers/registry";
import { getAiSettings } from "./settings";
import { estimateCost } from "./pricing";
import { buildTopologyContext } from "./topology-context";
import { getTopologyInstructions } from "./topology-instructions";

export interface TopologyRunRequest {
  schoolId: number;
  districtId: number;
  label: string;
  requestedBy?: number | null;
}

export async function prepareTopologyRun(
  req: TopologyRunRequest,
): Promise<{ runId: string; providerIds: string[] }> {
  const runId = randomUUID();
  const active = await activeProviders();
  if (active.length === 0) return { runId, providerIds: [] };
  const now = new Date();
  await db.insert(aiAnalyses).values(
    active.map(({ provider }) => ({
      runId,
      scopeType: "school" as const,
      scopeId: req.schoolId,
      districtId: req.districtId,
      windowStart: now,
      windowEnd: now,
      trigger: "manual" as const,
      kind: "topology",
      providerId: provider.id,
      status: "running" as const,
      requestedBy: req.requestedBy ?? null,
    })),
  );
  return { runId, providerIds: active.map(({ provider }) => provider.id) };
}

export async function executeTopologyRun(
  runId: string,
  req: TopologyRunRequest,
): Promise<void> {
  const active = await activeProviders();
  if (active.length === 0) return;

  const settings = await getAiSettings();
  const context = await buildTopologyContext(req.schoolId, req.label);
  const now = new Date();
  const input = {
    scope: { type: "school" as const, id: req.schoolId, districtId: req.districtId, label: req.label },
    window: { start: now, end: now },
    instructions: getTopologyInstructions(),
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
          .where(and(eq(aiAnalyses.runId, runId), eq(aiAnalyses.providerId, provider.id)));
      } catch (err) {
        await db
          .update(aiAnalyses)
          .set({
            status: "failed",
            error: (err as Error).message?.slice(0, 2000) ?? "unknown error",
            completedAt: new Date(),
          })
          .where(and(eq(aiAnalyses.runId, runId), eq(aiAnalyses.providerId, provider.id)));
      }
    }),
  );

  // Reconcile topology findings into the Issues tracker (school scope).
  try {
    const rows = await db
      .select({ findings: aiAnalyses.findings, status: aiAnalyses.status })
      .from(aiAnalyses)
      .where(eq(aiAnalyses.runId, runId));
    const ok = rows.filter((r) => r.status === "ok");
    if (ok.length > 0) {
      await reconcileIssues({
        districtId: req.districtId,
        scopeType: "school",
        scopeId: req.schoolId,
        source: "ai-topology",
        findings: ok.flatMap((r) => (Array.isArray(r.findings) ? (r.findings as AiFinding[]) : [])),
      });
    }
  } catch {
    // non-fatal
  }
}
