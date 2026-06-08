/**
 * Read side for stored AI analyses. Runs are grouped by runId so a single run's
 * per-model rows render as side-by-side comparison columns.
 */
import "server-only";
import { and, count, desc, eq, gte, max, sql, sum } from "drizzle-orm";

import { db } from "@/db";
import { aiAnalyses, securityAnalyses, type AiFinding } from "@/db/schema/ai";
import { districts, schools } from "@/db/schema/app";
import { chatMessages } from "@/db/schema/chat";
import { estimateCost } from "./pricing";
import { getMutedIssues } from "@/lib/issues/queries";
import { issueKeyFromTitle } from "@/lib/issues/reconcile";

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

/**
 * Last SUCCESSFUL analysis time per (scopeType, scopeId, kind) for a district,
 * keyed "scopeType:scopeId:kind". The scheduled sweep uses this to skip scopes
 * whose data hasn't changed since they were last analyzed — the core of scaling
 * to many schools. Failed/running rows are excluded, so a 429'd scope stays
 * "due" and is retried on a later wake.
 */
export async function getLastSuccessfulAnalysisMap(
  districtId: number,
): Promise<Map<string, Date>> {
  const rows = await db
    .select({
      scopeType: aiAnalyses.scopeType,
      scopeId: aiAnalyses.scopeId,
      kind: aiAnalyses.kind,
      last: max(aiAnalyses.createdAt),
    })
    .from(aiAnalyses)
    .where(and(eq(aiAnalyses.districtId, districtId), eq(aiAnalyses.status, "ok")))
    .groupBy(aiAnalyses.scopeType, aiAnalyses.scopeId, aiAnalyses.kind);

  const map = new Map<string, Date>();
  for (const r of rows) {
    if (r.last) map.set(`${r.scopeType}:${r.scopeId}:${r.kind}`, new Date(r.last));
  }
  return map;
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

  // AI-4: hide findings the operator muted so already-generated ones disappear
  // immediately (future runs are also told to skip them via the analysis context).
  const mutedScopeId = scopeType === "school" ? scopeId : districtId;
  const mutedKeys =
    mutedScopeId != null
      ? new Set((await getMutedIssues(scopeType, mutedScopeId)).map((m) => m.issueKey))
      : new Set<string>();

  const findings: AiFindingItem[] = ok
    .flatMap((r) => r.findings.map((f) => ({ ...f, model: r.model })))
    .filter((f) => !mutedKeys.has(issueKeyFromTitle(f.title)))
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

// ---- usage by category (AI-7) ---------------------------------------------

export interface CategoryUsage {
  category: "scheduled" | "security" | "assistant";
  label: string;
  /** runs (analysis) or turns (assistant). */
  units: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

/**
 * Month-to-date AI spend split by category (AI-7): scheduled/manual network
 * analysis, security analysis, and ad-hoc assistant usage (the in-app chatbot +
 * the AI-6 "Help me fix this" drill-down, which both flow through chat_messages).
 * Chat rows have no stored cost, so it's computed per-model via estimateCost.
 */
export async function getAiUsageByCategory(): Promise<CategoryUsage[]> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [sched] = await db
    .select({
      runs: count(),
      tokensIn: sum(aiAnalyses.tokensIn),
      tokensOut: sum(aiAnalyses.tokensOut),
      costUsd: sum(aiAnalyses.costUsd),
    })
    .from(aiAnalyses)
    .where(gte(aiAnalyses.createdAt, monthStart));

  const [sec] = await db
    .select({
      runs: count(),
      tokensIn: sum(securityAnalyses.tokensIn),
      tokensOut: sum(securityAnalyses.tokensOut),
      costUsd: sum(securityAnalyses.costUsd),
    })
    .from(securityAnalyses)
    .where(gte(securityAnalyses.createdAt, monthStart));

  // Assistant: group by model so cost can be priced per-model (no stored cost).
  const chatRows = await db
    .select({
      model: chatMessages.model,
      turns: count(),
      tokensIn: sum(chatMessages.tokensIn),
      tokensOut: sum(chatMessages.tokensOut),
    })
    .from(chatMessages)
    .where(and(eq(chatMessages.role, "assistant"), gte(chatMessages.createdAt, monthStart)))
    .groupBy(chatMessages.model);

  let chatTurns = 0;
  let chatIn = 0;
  let chatOut = 0;
  let chatCost = 0;
  for (const r of chatRows) {
    const tin = Number(r.tokensIn ?? 0);
    const tout = Number(r.tokensOut ?? 0);
    chatTurns += Number(r.turns ?? 0);
    chatIn += tin;
    chatOut += tout;
    chatCost += estimateCost(r.model, tin, tout) ?? 0;
  }

  return [
    {
      category: "scheduled",
      label: "Scheduled analysis",
      units: Number(sched?.runs ?? 0),
      tokensIn: Number(sched?.tokensIn ?? 0),
      tokensOut: Number(sched?.tokensOut ?? 0),
      costUsd: Number(sched?.costUsd ?? 0),
    },
    {
      category: "security",
      label: "Security analysis",
      units: Number(sec?.runs ?? 0),
      tokensIn: Number(sec?.tokensIn ?? 0),
      tokensOut: Number(sec?.tokensOut ?? 0),
      costUsd: Number(sec?.costUsd ?? 0),
    },
    {
      category: "assistant",
      label: "Assistant & drill-down",
      units: chatTurns,
      tokensIn: chatIn,
      tokensOut: chatOut,
      costUsd: chatCost,
    },
  ];
}

// ---- activity log + daily usage (the "what/when/where" view) ---------------

export interface RecentAiRun {
  id: number;
  createdAt: Date;
  completedAt: Date | null;
  /** 'scheduled' | 'manual'. */
  trigger: string;
  /** 'general' | 'topology'. */
  kind: string;
  /** Human label of what was analyzed (district, or "District — School"). */
  scopeLabel: string;
  scopeType: string;
  providerId: string;
  model: string | null;
  /** 'running' | 'ok' | 'failed'. */
  status: string;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  latencyMs: number | null;
  error: string | null;
}

/** The most recent analysis rows across all scopes — the activity feed. Each row
 *  is one model call, labeled with what/when/where so a 429 (or any failure) is
 *  visible alongside the run that caused it. */
export async function getRecentAiRuns(limit = 30): Promise<RecentAiRun[]> {
  const rows = await db
    .select({
      id: aiAnalyses.id,
      createdAt: aiAnalyses.createdAt,
      completedAt: aiAnalyses.completedAt,
      trigger: aiAnalyses.trigger,
      kind: aiAnalyses.kind,
      scopeType: aiAnalyses.scopeType,
      districtName: districts.name,
      schoolName: schools.name,
      providerId: aiAnalyses.providerId,
      model: aiAnalyses.model,
      status: aiAnalyses.status,
      tokensIn: aiAnalyses.tokensIn,
      tokensOut: aiAnalyses.tokensOut,
      costUsd: aiAnalyses.costUsd,
      latencyMs: aiAnalyses.latencyMs,
      error: aiAnalyses.error,
    })
    .from(aiAnalyses)
    .leftJoin(districts, eq(aiAnalyses.districtId, districts.id))
    .leftJoin(
      schools,
      and(eq(aiAnalyses.scopeType, "school"), eq(aiAnalyses.scopeId, schools.id)),
    )
    .orderBy(desc(aiAnalyses.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    completedAt: r.completedAt,
    trigger: r.trigger,
    kind: r.kind,
    scopeType: r.scopeType,
    scopeLabel:
      r.scopeType === "school"
        ? `${r.districtName ?? "?"} — ${r.schoolName ?? "(school)"}`
        : r.districtName ?? "(district)",
    providerId: r.providerId,
    model: r.model,
    status: r.status,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    costUsd: r.costUsd,
    latencyMs: r.latencyMs,
    error: r.error,
  }));
}

export interface DailyAiUsage {
  /** YYYY-MM-DD (server timezone). */
  day: string;
  runs: number;
  failed: number;
  /** tokensIn + tokensOut. */
  tokens: number;
  costUsd: number;
}

/** Per-day rollup over the last `days` days — the usage timeline. Days with no
 *  runs are omitted here; the UI fills the gaps so the axis stays continuous. */
export async function getDailyAiUsage(days = 14): Promise<DailyAiUsage[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const dayExpr = sql<string>`to_char(${aiAnalyses.createdAt}, 'YYYY-MM-DD')`;

  const rows = await db
    .select({
      day: dayExpr,
      runs: count(),
      failed: sum(sql<number>`case when ${aiAnalyses.status} = 'failed' then 1 else 0 end`),
      tokensIn: sum(aiAnalyses.tokensIn),
      tokensOut: sum(aiAnalyses.tokensOut),
      costUsd: sum(aiAnalyses.costUsd),
    })
    .from(aiAnalyses)
    .where(gte(aiAnalyses.createdAt, since))
    .groupBy(dayExpr)
    .orderBy(dayExpr);

  return rows.map((r) => ({
    day: r.day,
    runs: Number(r.runs ?? 0),
    failed: Number(r.failed ?? 0),
    tokens: Number(r.tokensIn ?? 0) + Number(r.tokensOut ?? 0),
    costUsd: Number(r.costUsd ?? 0),
  }));
}
