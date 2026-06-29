import "server-only";
import { and, count, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { issues } from "@/db/schema";
import { schools } from "@/db/schema/app";
import { severityRank } from "@/lib/severity";

export interface IssueRow {
  id: number;
  scopeType: string;
  scopeId: number;
  scopeLabel: string;
  severity: string;
  confidence: string | null;
  title: string;
  detail: string | null;
  recommendation: string | null;
  status: string;
  source: string;
  occurrences: number;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  resolvedAt: Date | null;
}

const OPEN = ["open", "acknowledged"];

function sortIssues(a: IssueRow, b: IssueRow): number {
  const sa = a.status === "resolved" ? 1 : 0;
  const sb = b.status === "resolved" ? 1 : 0;
  if (sa !== sb) return sa - sb;
  const ra = severityRank(a.severity);
  const rb = severityRank(b.severity);
  if (ra !== rb) return ra - rb;
  return (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0);
}

async function shape(rows: (typeof issues.$inferSelect)[]): Promise<IssueRow[]> {
  const schoolIds = [...new Set(rows.filter((r) => r.scopeType === "school").map((r) => r.scopeId))];
  const schoolMap = new Map<number, string>();
  if (schoolIds.length) {
    const srows = await db
      .select({ id: schools.id, name: schools.name, slug: schools.slug })
      .from(schools)
      .where(inArray(schools.id, schoolIds));
    for (const s of srows) schoolMap.set(s.id, s.name || s.slug);
  }
  const out = rows.map((r) => ({
    id: r.id,
    scopeType: r.scopeType,
    scopeId: r.scopeId,
    scopeLabel: r.scopeType === "school" ? (schoolMap.get(r.scopeId) ?? `school ${r.scopeId}`) : "District-wide",
    severity: r.severity,
    confidence: r.confidence,
    title: r.title,
    detail: r.detail,
    recommendation: r.recommendation,
    status: r.status,
    source: r.source,
    occurrences: r.occurrences,
    firstSeenAt: r.firstSeenAt,
    lastSeenAt: r.lastSeenAt,
    resolvedAt: r.resolvedAt,
  }));
  out.sort(sortIssues);
  return out;
}

export async function listIssuesForDistrict(
  districtId: number,
  opts: { includeResolved?: boolean } = {},
): Promise<IssueRow[]> {
  const conds = [eq(issues.districtId, districtId)];
  if (!opts.includeResolved) conds.push(inArray(issues.status, OPEN));
  const rows = await db
    .select()
    .from(issues)
    .where(and(...conds))
    .orderBy(desc(issues.lastSeenAt))
    .limit(500);
  return shape(rows);
}

export async function listIssuesForSchool(
  schoolId: number,
  opts: { includeResolved?: boolean } = {},
): Promise<IssueRow[]> {
  const conds = [eq(issues.scopeType, "school"), eq(issues.scopeId, schoolId)];
  if (!opts.includeResolved) conds.push(inArray(issues.status, OPEN));
  const rows = await db
    .select()
    .from(issues)
    .where(and(...conds))
    .orderBy(desc(issues.lastSeenAt))
    .limit(200);
  return shape(rows);
}

export async function countOpenIssuesForDistrict(districtId: number): Promise<number> {
  const [row] = await db
    .select({ c: count() })
    .from(issues)
    .where(and(eq(issues.districtId, districtId), inArray(issues.status, OPEN)));
  return row?.c ?? 0;
}

/**
 * Issues the operator muted (AI-4) for a scope — "don't warn me again". Keyed by
 * (scopeType, scopeId), the same identity reconcile + ai_analyses use. Drives
 * both telling the next analysis run to skip them and filtering them out of the
 * AI findings surfaced on overviews.
 */
export async function getMutedIssues(
  scopeType: string,
  scopeId: number,
): Promise<{ issueKey: string; title: string }[]> {
  return db
    .select({ issueKey: issues.issueKey, title: issues.title })
    .from(issues)
    .where(
      and(
        eq(issues.scopeType, scopeType),
        eq(issues.scopeId, scopeId),
        eq(issues.status, "muted"),
      ),
    );
}

export async function countOpenIssuesForSchool(schoolId: number): Promise<number> {
  const [row] = await db
    .select({ c: count() })
    .from(issues)
    .where(
      and(eq(issues.scopeType, "school"), eq(issues.scopeId, schoolId), inArray(issues.status, OPEN)),
    );
  return row?.c ?? 0;
}
