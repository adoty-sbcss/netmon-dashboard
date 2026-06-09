/**
 * Builds the evidence the global security analysis reads: security_events over a
 * window, aggregated into a compact, deterministic JSON snapshot (counts by
 * category/severity/action, the busiest source IPs, the accounts with the most
 * failed logins, the notable events verbatim, and a 7-day trend).
 *
 * Relative imports + no `server-only` so the cron Job can import this under tsx
 * (mirrors orchestrator.ts / context.ts).
 */
import { and, gte, lte, desc, inArray, sql } from "drizzle-orm";

import { db } from "../../db";
import { securityEvents, auditLog } from "../../db/schema/app";
import type { AnalysisWindow } from "./types";

// Cap the detailed fetch so a flood can't blow up the prompt; the COUNTS remain
// exact (computed separately). If we hit the cap we tell the model it's truncated.
const MAX_FETCH = 4000;
const MAX_SOURCE_IPS = 15;
const MAX_ACTIONS = 20;
const MAX_FAILED_ACTORS = 10;
const MAX_NOTABLE = 60;

// Privileged audit actions surfaced as insider-risk signal — config/credential
// changes and destructive ops, so the analysis sees "who changed what," not just
// inbound attacks. Routine for an admin; suspicious if unexpected or off-hours.
const PRIVILEGED_ACTIONS = [
  "user_added",
  "user_updated",
  "user_disabled",
  "user_enabled",
  "user_deleted",
  "user_password_set",
  "user_password_cleared",
  "sensor_enrolled",
  "sensor_config_saved",
  "sensor_command_queued",
  "sensor_bulk_update_queued",
  "sensor_bulk_sftp_set",
  "data_delete",
  "data_purge_scans",
  "data_reset_sensor",
  "ingest_settings_saved",
  "ai_provider_settings_saved",
];

export interface SecurityContextResult {
  context: string;
  eventCount: number;
}

/** Cheap exact count of events in the window (used to skip empty scheduled runs). */
export async function countSecurityEvents(window: AnalysisWindow): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(securityEvents)
    .where(and(gte(securityEvents.at, window.start), lte(securityEvents.at, window.end)));
  return row?.total ?? 0;
}

function inc(map: Record<string, number>, key: string | null | undefined): void {
  const k = key ?? "unknown";
  map[k] = (map[k] ?? 0) + 1;
}

function topN(map: Record<string, number>, n: number): Array<{ key: string; count: number }> {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}

export async function buildSecurityContext(
  window: AnalysisWindow,
): Promise<SecurityContextResult> {
  const inWindow = and(gte(securityEvents.at, window.start), lte(securityEvents.at, window.end));

  const total = await countSecurityEvents(window);

  const rows = await db
    .select({
      at: securityEvents.at,
      category: securityEvents.category,
      severity: securityEvents.severity,
      action: securityEvents.action,
      actorType: securityEvents.actorType,
      actor: securityEvents.actor,
      sourceIp: securityEvents.sourceIp,
      target: securityEvents.target,
      detail: securityEvents.detail,
    })
    .from(securityEvents)
    .where(inWindow)
    .orderBy(desc(securityEvents.at))
    .limit(MAX_FETCH);

  const byCategory: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  const byAction: Record<string, number> = {};
  const byIp: Record<string, number> = {};
  const ipActions = new Map<string, Record<string, number>>();
  const failedLoginActors: Record<string, number> = {};

  const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

  for (const e of rows) {
    inc(byCategory, e.category);
    inc(bySeverity, e.severity);
    inc(byAction, e.action);
    if (e.sourceIp) {
      inc(byIp, e.sourceIp);
      const m = ipActions.get(e.sourceIp) ?? {};
      inc(m, e.action);
      ipActions.set(e.sourceIp, m);
    }
    if (e.action === "login_failed" && e.actor) inc(failedLoginActors, e.actor);
  }

  const topSourceIps = topN(byIp, MAX_SOURCE_IPS).map(({ key, count }) => ({
    ip: key,
    count,
    actions: ipActions.get(key) ?? {},
  }));

  // Notable = critical/high first (by severity then recency), padded with the most
  // recent remaining events so the model always has concrete samples to cite.
  const ranked = [...rows].sort((a, b) => {
    const r = (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9);
    return r !== 0 ? r : b.at.getTime() - a.at.getTime();
  });
  const notableEvents = ranked.slice(0, MAX_NOTABLE).map((e) => ({
    at: e.at.toISOString(),
    severity: e.severity,
    category: e.category,
    action: e.action,
    actorType: e.actorType ?? undefined,
    actor: e.actor ?? undefined,
    sourceIp: e.sourceIp ?? undefined,
    target: e.target ?? undefined,
    detail: e.detail ?? undefined,
  }));

  // 7-day daily trend (independent of the analysis window) for "is this rising?".
  const trendStart = new Date(window.end.getTime() - 7 * 24 * 60 * 60 * 1000);
  const trendRows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${securityEvents.at}), 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
      elevated: sql<number>`count(*) filter (where ${securityEvents.severity} in ('high','critical'))::int`,
    })
    .from(securityEvents)
    .where(and(gte(securityEvents.at, trendStart), lte(securityEvents.at, window.end)))
    .groupBy(sql`date_trunc('day', ${securityEvents.at})`)
    .orderBy(sql`date_trunc('day', ${securityEvents.at})`);

  // Privileged admin activity over the last 7 days (insider-risk signal).
  const adminSince = new Date(window.end.getTime() - 7 * 24 * 60 * 60 * 1000);
  const adminRows = await db
    .select({
      at: auditLog.at,
      actor: auditLog.actor,
      action: auditLog.action,
      target: auditLog.target,
    })
    .from(auditLog)
    .where(and(gte(auditLog.at, adminSince), inArray(auditLog.action, PRIVILEGED_ACTIONS)))
    .orderBy(desc(auditLog.at))
    .limit(60);
  const adminByAction: Record<string, number> = {};
  for (const a of adminRows) inc(adminByAction, a.action);
  const privilegedAdminActivity7d = {
    total: adminRows.length,
    byAction: adminByAction,
    recent: adminRows.slice(0, 30).map((a) => ({
      at: a.at.toISOString(),
      actor: a.actor ?? undefined,
      action: a.action,
      target: a.target ?? undefined,
    })),
  };

  const snapshot = {
    window: {
      start: window.start.toISOString(),
      end: window.end.toISOString(),
      hours: Math.round((window.end.getTime() - window.start.getTime()) / 3_600_000),
    },
    totalEvents: total,
    truncated: rows.length < total,
    byCategory,
    bySeverity,
    topActions: topN(byAction, MAX_ACTIONS).map(({ key, count }) => ({ action: key, count })),
    topSourceIps,
    topFailedLoginActors: topN(failedLoginActors, MAX_FAILED_ACTORS).map(({ key, count }) => ({
      actor: key,
      count,
    })),
    notableEvents,
    privilegedAdminActivity7d,
    dailyTrend7d: trendRows,
  };

  return { context: JSON.stringify(snapshot), eventCount: total };
}
