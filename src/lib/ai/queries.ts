/**
 * Read side for stored AI analyses. Runs are grouped by runId so a single run's
 * per-model rows render as side-by-side comparison columns.
 */
import "server-only";
import { and, count, desc, eq, gte, sql, sum } from "drizzle-orm";

import { db } from "@/db";
import { aiAnalyses, type AiFinding } from "@/db/schema/ai";

export interface AnalysisRow {
  id: number;
  providerId: string;
  model: string | null;
  status: string;
  prose: string | null;
  findings: AiFinding[];
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number | null;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface AnalysisRun {
  runId: string;
  scopeType: string;
  scopeId: number;
  districtId: number;
  trigger: string;
  windowStart: Date | null;
  windowEnd: Date | null;
  createdAt: Date;
  rows: AnalysisRow[];
}

function toRow(r: typeof aiAnalyses.$inferSelect): AnalysisRow {
  return {
    id: r.id,
    providerId: r.providerId,
    model: r.model,
    status: r.status,
    prose: r.prose,
    findings: (r.findings ?? []) as AiFinding[],
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    latencyMs: r.latencyMs,
    error: r.error,
    createdAt: r.createdAt,
    completedAt: r.completedAt,
  };
}

function groupRun(rows: (typeof aiAnalyses.$inferSelect)[]): AnalysisRun | null {
  if (rows.length === 0) return null;
  const first = rows[0];
  return {
    runId: first.runId,
    scopeType: first.scopeType,
    scopeId: first.scopeId,
    districtId: first.districtId,
    trigger: first.trigger,
    windowStart: first.windowStart,
    windowEnd: first.windowEnd,
    createdAt: first.createdAt,
    rows: rows.map(toRow),
  };
}

/** All rows for one run (the comparison columns). */
export async function getRun(runId: string): Promise<AnalysisRun | null> {
  const rows = await db
    .select()
    .from(aiAnalyses)
    .where(eq(aiAnalyses.runId, runId))
    .orderBy(aiAnalyses.providerId);
  return groupRun(rows);
}

/** The most recent run for a district scope (defaults to district-wide). */
export async function getLatestRunForDistrict(
  districtId: number,
  scopeType: "district" | "school" = "district",
  scopeId?: number,
  kind: string = "general",
): Promise<AnalysisRun | null> {
  const [latest] = await db
    .select({ runId: aiAnalyses.runId })
    .from(aiAnalyses)
    .where(
      and(
        eq(aiAnalyses.districtId, districtId),
        eq(aiAnalyses.scopeType, scopeType),
        eq(aiAnalyses.kind, kind),
        scopeId != null ? eq(aiAnalyses.scopeId, scopeId) : undefined,
      ),
    )
    .orderBy(desc(aiAnalyses.createdAt))
    .limit(1);
  if (!latest) return null;
  return getRun(latest.runId);
}

/** The most recent TOPOLOGY analysis run for a school. */
export function getLatestTopologyRun(
  districtId: number,
  schoolId: number,
): Promise<AnalysisRun | null> {
  return getLatestRunForDistrict(districtId, "school", schoolId, "topology");
}

// ---- latest-run summary for surfacing in Findings / overview --------------

export interface AiFindingItem extends AiFinding {
  /** Which model produced it (so a merged list stays attributable). */
  model: string | null;
}

export interface LatestAiSummary {
  runId: string;
  createdAt: Date;
  trigger: string;
  /** Narrative from the first successful model (the exec summary). */
  prose: string | null;
  model: string | null;
  /** How many models succeeded in this run. */
  providerCount: number;
  /** Findings merged across successful models, severity-sorted. */
  findings: AiFindingItem[];
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/** The latest analysis run for a scope, flattened for display in the Findings
 *  section + district overview. Null when no run exists yet. */
export async function getLatestAiSummary(
  districtId: number,
  scopeType: "district" | "school" = "district",
  scopeId?: number,
): Promise<LatestAiSummary | null> {
  const run = await getLatestRunForDistrict(districtId, scopeType, scopeId);
  if (!run) return null;
  const ok = run.rows.filter((r) => r.status === "ok");
  const findings: AiFindingItem[] = ok
    .flatMap((r) => r.findings.map((f) => ({ ...f, model: r.model })))
    .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9));
  return {
    runId: run.runId,
    createdAt: run.createdAt,
    trigger: run.trigger,
    prose: ok[0]?.prose ?? null,
    model: ok[0]?.model ?? null,
    providerCount: ok.length,
    findings,
  };
}

// ---- usage analysis -------------------------------------------------------

export interface ProviderUsage {
  providerId: string;
  runs: number;
  failed: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

/** Per-provider usage since the start of the current month (server-local). */
export async function getAiUsageThisMonth(): Promise<ProviderUsage[]> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const rows = await db
    .select({
      providerId: aiAnalyses.providerId,
      runs: count(),
      tokensIn: sum(aiAnalyses.tokensIn),
      tokensOut: sum(aiAnalyses.tokensOut),
      costUsd: sum(aiAnalyses.costUsd),
      failed: sum(
        sql<number>`case when ${aiAnalyses.status} = 'failed' then 1 else 0 end`,
      ),
    })
    .from(aiAnalyses)
    .where(gte(aiAnalyses.createdAt, monthStart))
    .groupBy(aiAnalyses.providerId);

  return rows.map((r) => ({
    providerId: r.providerId,
    runs: Number(r.runs ?? 0),
    failed: Number(r.failed ?? 0),
    tokensIn: Number(r.tokensIn ?? 0),
    tokensOut: Number(r.tokensOut ?? 0),
    costUsd: Number(r.costUsd ?? 0),
  }));
}
