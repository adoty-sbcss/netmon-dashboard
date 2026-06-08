/**
 * Reconcile a finished analysis run's findings into the persistent Issues
 * tracker. Bumps a matching open issue (occurrences++, lastSeen, reset misses) or
 * opens a new one; issues absent from this run get a missed-run tick and
 * auto-resolve after MISS_CAP consecutive misses.
 *
 * Relative imports + no `server-only` so the cron Job (tsx) can import it via the
 * AI orchestrator, same as the rest of src/lib/ai.
 */
import { and, eq } from "drizzle-orm";

import { db } from "../../db";
import { issues } from "../../db/schema/issues";
import type { AiFinding } from "../../db/schema/ai";

const MISS_CAP = 2; // auto-resolve after this many consecutive runs absent

const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

/** Stable dedup key for an issue within a scope: a slug of its title. */
export function issueKeyFromTitle(title: string): string {
  const k = (title || "untitled")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return k || "untitled";
}

export async function reconcileIssues(opts: {
  districtId: number;
  scopeType: "district" | "school";
  scopeId: number;
  source: string;
  findings: AiFinding[];
}): Promise<void> {
  const { districtId, scopeType, scopeId, source, findings } = opts;

  // Dedup incoming findings by key; keep the highest-severity instance.
  const byKey = new Map<string, AiFinding>();
  for (const f of findings) {
    const k = issueKeyFromTitle(f.title);
    const cur = byKey.get(k);
    if (!cur || (SEV_RANK[f.severity] ?? 9) < (SEV_RANK[cur.severity] ?? 9)) byKey.set(k, f);
  }
  const seen = new Set(byKey.keys());

  const existing = await db
    .select()
    .from(issues)
    .where(
      and(
        eq(issues.scopeType, scopeType),
        eq(issues.scopeId, scopeId),
        eq(issues.source, source),
      ),
    );
  const existingByKey = new Map(existing.map((e) => [e.issueKey, e]));

  for (const [k, f] of byKey) {
    const ex = existingByKey.get(k);
    if (ex) {
      const reopened = ex.status === "resolved";
      await db
        .update(issues)
        .set({
          severity: f.severity,
          confidence: f.confidence,
          title: f.title,
          detail: f.detail,
          recommendation: f.recommendation,
          status: reopened ? "open" : ex.status,
          resolvedAt: reopened ? null : ex.resolvedAt,
          occurrences: ex.occurrences + 1,
          missedRuns: 0,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(issues.id, ex.id));
    } else {
      await db.insert(issues).values({
        districtId,
        scopeType,
        scopeId,
        issueKey: k,
        source,
        severity: f.severity,
        confidence: f.confidence,
        title: f.title,
        detail: f.detail,
        recommendation: f.recommendation,
        status: "open",
      });
    }
  }

  // Issues not surfaced this run: tick the miss counter; auto-resolve at the cap.
  // Muted issues (AI-4) are held — never auto-resolved — so a mute stays sticky
  // even across runs where the issue disappears and later returns.
  for (const e of existing) {
    if (e.status === "resolved" || e.status === "muted" || seen.has(e.issueKey)) continue;
    const missed = e.missedRuns + 1;
    const resolve = missed >= MISS_CAP;
    await db
      .update(issues)
      .set({
        missedRuns: missed,
        status: resolve ? "resolved" : e.status,
        resolvedAt: resolve ? new Date() : e.resolvedAt,
        updatedAt: new Date(),
      })
      .where(eq(issues.id, e.id));
  }
}
