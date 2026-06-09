/**
 * Read side for the GLOBAL security analysis + the raw security_events feed.
 * Mirrors queries.ts (runs grouped by runId → per-model comparison columns) but
 * over security_analyses, which has no district scope.
 */
import "server-only";
import { desc, eq, gte, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { securityAnalyses, type AiFinding } from "@/db/schema/ai";
import { securityEvents } from "@/db/schema/app";

export interface SecurityAnalysisRow {
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

export interface SecurityAnalysisRun {
  runId: string;
  trigger: string;
  windowStart: Date | null;
  windowEnd: Date | null;
  eventCount: number | null;
  createdAt: Date;
  rows: SecurityAnalysisRow[];
}

function toRow(r: typeof securityAnalyses.$inferSelect): SecurityAnalysisRow {
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

function groupRun(rows: (typeof securityAnalyses.$inferSelect)[]): SecurityAnalysisRun | null {
  if (rows.length === 0) return null;
  const first = rows[0];
  return {
    runId: first.runId,
    trigger: first.trigger,
    windowStart: first.windowStart,
    windowEnd: first.windowEnd,
    eventCount: first.eventCount,
    createdAt: first.createdAt,
    rows: rows.map(toRow),
  };
}

/** All per-model rows for one security run (the comparison columns). */
export async function getSecurityRun(runId: string): Promise<SecurityAnalysisRun | null> {
  const rows = await db
    .select()
    .from(securityAnalyses)
    .where(eq(securityAnalyses.runId, runId))
    .orderBy(securityAnalyses.providerId);
  return groupRun(rows);
}

/** The most recent security run (global — there is no scope). */
export async function getLatestSecurityRun(): Promise<SecurityAnalysisRun | null> {
  const [latest] = await db
    .select({ runId: securityAnalyses.runId })
    .from(securityAnalyses)
    .orderBy(desc(securityAnalyses.createdAt))
    .limit(1);
  if (!latest) return null;
  return getSecurityRun(latest.runId);
}

export interface SecurityEventItem {
  id: number;
  at: Date;
  category: string;
  severity: string;
  action: string;
  actorType: string | null;
  actor: string | null;
  sourceIp: string | null;
  userAgent: string | null;
  target: string | null;
  detail: unknown;
}

/** The most recent raw security events — the feed the analysis reads. Carries the
 *  full detail + user-agent so the events table can expand each row. */
export async function getRecentSecurityEvents(limit = 40): Promise<SecurityEventItem[]> {
  return db
    .select({
      id: securityEvents.id,
      at: securityEvents.at,
      category: securityEvents.category,
      severity: securityEvents.severity,
      action: securityEvents.action,
      actorType: securityEvents.actorType,
      actor: securityEvents.actor,
      sourceIp: securityEvents.sourceIp,
      userAgent: securityEvents.userAgent,
      target: securityEvents.target,
      detail: securityEvents.detail,
    })
    .from(securityEvents)
    .orderBy(desc(securityEvents.at))
    .limit(limit);
}

export interface SecurityOverview {
  total24h: number;
  elevated24h: number;
  unreviewed: number;
}

/** Headline counts for the page: 24h volume, 24h high/critical, and how many
 *  events the AI pass hasn't reviewed yet. */
export async function getSecurityOverview(): Promise<SecurityOverview> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [win] = await db
    .select({
      total: sql<number>`count(*)::int`,
      elevated: sql<number>`count(*) filter (where ${securityEvents.severity} in ('high','critical'))::int`,
    })
    .from(securityEvents)
    .where(gte(securityEvents.at, since));
  const [un] = await db
    .select({ unreviewed: sql<number>`count(*)::int` })
    .from(securityEvents)
    .where(isNull(securityEvents.analyzedAt));
  return {
    total24h: win?.total ?? 0,
    elevated24h: win?.elevated ?? 0,
    unreviewed: un?.unreviewed ?? 0,
  };
}
