/**
 * Deterministic STP-instability rule → Issues tracker.
 *
 * Background (UX-5): the dashboard intentionally has NO raw "STP / BPDU log" page
 * — a passive single-port BPDU dump isn't actionable for site techs, and a naive
 * "more than one root bridge" check false-positives on PVST/Rapid-PVST (one root
 * PER VLAN is normal). What IS a real, legible signal is a sustained RATE of
 * spanning-tree TOPOLOGY-CHANGE notifications (TCN): healthy STP emits a TC only
 * briefly when a port/device comes up; TCs recurring across many scans point to a
 * flapping link, an access/edge port without PortFast/edge configured, or — worst
 * case — an intermittent layer-2 loop. This rate signal is VLAN-AGNOSTIC, so it
 * sidesteps the PVST false positive entirely. `stp_events` carries no VLAN, so
 * root-based detection is deliberately NOT attempted.
 *
 * Runs from the daily maintenance Job (a deterministic cadence that does NOT
 * depend on AI provider keys) and feeds reconcileIssues with source 'rule', so it
 * dedupes, accumulates occurrences, and AUTO-RESOLVES once stability returns — the
 * same anti-fatigue lifecycle as the AI findings. Relative imports + no
 * `server-only` so the cron Job's tsx can import it (mirrors issues/reconcile.ts).
 */
import { and, eq, gte, ne, sql } from "drizzle-orm";

import { db } from "../../db";
import { scanRuns, stpEvents } from "../../db/schema/netmon";
import { sensors, schools, districts } from "../../db/schema/app";
import { issues } from "../../db/schema/issues";
import { reconcileIssues } from "../issues/reconcile";
import type { AiFinding } from "../../db/schema/ai";

function intEnv(name: string, dflt: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
}

// Look-back window the rule evaluates each run. The maintenance Job runs daily,
// so 24h gives a rolling daily picture. Tunable via env without a redeploy.
const WINDOW_HOURS = intEnv("STP_RULE_WINDOW_HOURS", 24);

// Thresholds are in DISTINCT SCANS that contained >=1 topology-change BPDU — a
// capture-duration-independent measure of how RECURRING the churn is (a one-off
// device boot shows up in 1, maybe 2, consecutive scans). Conservative by design:
// the analyst brief favors low-noise, and "all clear" is a valid result.
const MIN_SCANS = 3; // need at least this many scans in-window to judge at all
const MEDIUM_SCANS_WITH_TC = 3; // recurring -> worth investigating
const HIGH_SCANS_WITH_TC = 6; // sustained -> likely an active flap/loop
const HIGH_MIN_FRACTION = 0.2; // ...and in a meaningful share of all scans

export interface StpStat {
  schoolId: number;
  districtId: number;
  /** scan_runs for this school's sensors with ingested_at in the window. */
  totalScans: number;
  /** distinct scan_runs that contained >=1 topology-change BPDU. */
  scansWithTc: number;
  /** total topology-change BPDUs in the window. */
  tcEvents: number;
}

/**
 * Build the 0-or-1 finding for one school's window stats. Pure + side-effect free
 * so the threshold logic is easy to reason about (and unit-test) in isolation.
 */
export function stpFindingsFor(stat: StpStat): AiFinding[] {
  const { totalScans, scansWithTc, tcEvents } = stat;
  if (totalScans < MIN_SCANS || scansWithTc < MEDIUM_SCANS_WITH_TC) return [];

  const fraction = scansWithTc / totalScans;
  const high = scansWithTc >= HIGH_SCANS_WITH_TC && fraction >= HIGH_MIN_FRACTION;
  const pct = Math.round(fraction * 100);

  // TITLE IS CONSTANT — reconcileIssues keys the issue on slug(title), so the
  // changing numbers MUST live in detail, never the title, or every run would
  // mint a brand-new issue instead of bumping the existing one.
  const title = "Frequent spanning-tree (STP) topology changes";
  const detail =
    `Spanning-tree topology-change notifications were seen in ${scansWithTc} of ${totalScans} ` +
    `scans (${pct}%) over the last ${WINDOW_HOURS}h — ${tcEvents} TC notification${tcEvents === 1 ? "" : "s"} total. ` +
    `Healthy spanning-tree emits these only briefly when a device or link comes up; seeing them recur ` +
    `across many scans points to a flapping link, an access/edge port without PortFast/edge configured ` +
    `(so a device reboot churns the tree), or — worst case — an intermittent layer-2 loop.`;
  const recommendation =
    `Check the switch logs for what's triggering the changes (look for a port repeatedly going up/down, ` +
    `and for "topology change"/"TCN" messages naming a port). Make sure access ports that connect end ` +
    `devices have PortFast/edge-port set so a PC or AP rebooting doesn't recalculate the tree. If the ` +
    `churn tracks one uplink, inspect that cable/SFP/port. Confirm on the switch before changing anything.`;

  return [
    {
      severity: high ? "high" : "medium",
      confidence: high ? "definite" : "suggestive",
      title,
      detail,
      evidence:
        `stp_events: topology_change=true in ${scansWithTc}/${totalScans} scans (${pct}%), ` +
        `${tcEvents} event${tcEvents === 1 ? "" : "s"}, last ${WINDOW_HOURS}h`,
      recommendation,
    },
  ];
}

/**
 * Evaluate the STP rule for every non-demo school with recent scan data (or an
 * existing open STP issue, so a now-quiet school's issue can still tick toward
 * auto-resolve), and reconcile each into the Issues tracker under source 'rule'.
 * Demo districts are skipped — their issues are curated — exactly like the AI
 * sweep. Returns a small tally for the job log.
 *
 * Two grouped queries cover all schools regardless of fleet size (no per-school
 * round-trips), so this scales the same way the AI sweep is built to.
 */
export async function evaluateStpRules(
  opts: { dryRun?: boolean } = {},
): Promise<{ schoolsEvaluated: number; flagged: number }> {
  const cutoff = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000);

  // school -> districtId, for non-demo schools only (also the demo filter).
  const schoolRows = await db
    .select({ schoolId: schools.id, districtId: schools.districtId })
    .from(schools)
    .innerJoin(districts, eq(schools.districtId, districts.id))
    .where(eq(districts.isDemo, false));
  const districtBySchool = new Map(schoolRows.map((r) => [r.schoolId, r.districtId]));

  // totalScans per school in-window (window on ingested_at: NOT NULL + monotonic,
  // same clock the retention purge uses).
  const totalRows = await db
    .select({ schoolId: sensors.schoolId, n: sql<number>`count(*)::int` })
    .from(scanRuns)
    .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
    .where(gte(scanRuns.ingestedAt, cutoff))
    .groupBy(sensors.schoolId);
  const totalBySchool = new Map(totalRows.map((r) => [r.schoolId, r.n]));

  // scansWithTc + tcEvents per school in-window.
  const tcRows = await db
    .select({
      schoolId: sensors.schoolId,
      scansWithTc: sql<number>`count(distinct ${stpEvents.scanRunId})::int`,
      tcEvents: sql<number>`count(*)::int`,
    })
    .from(stpEvents)
    .innerJoin(scanRuns, eq(stpEvents.scanRunId, scanRuns.id))
    .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
    .where(and(gte(scanRuns.ingestedAt, cutoff), eq(stpEvents.topologyChange, true)))
    .groupBy(sensors.schoolId);
  const tcBySchool = new Map(tcRows.map((r) => [r.schoolId, r]));

  // Schools with an existing (non-resolved) 'rule' issue must be reconciled even
  // with no scans this window, so a now-quiet issue can tick toward auto-resolve.
  const openRuleIssueRows = await db
    .select({ scopeId: issues.scopeId })
    .from(issues)
    .where(
      and(
        eq(issues.source, "rule"),
        eq(issues.scopeType, "school"),
        ne(issues.status, "resolved"),
      ),
    );

  const schoolsToEval = new Set<number>([
    ...totalBySchool.keys(),
    ...openRuleIssueRows.map((r) => r.scopeId),
  ]);

  let evaluated = 0;
  let flagged = 0;
  for (const schoolId of schoolsToEval) {
    const districtId = districtBySchool.get(schoolId);
    if (districtId == null) continue; // demo or deleted school — skip
    evaluated++;
    const tc = tcBySchool.get(schoolId);
    const stat: StpStat = {
      schoolId,
      districtId,
      totalScans: totalBySchool.get(schoolId) ?? 0,
      scansWithTc: tc?.scansWithTc ?? 0,
      tcEvents: tc?.tcEvents ?? 0,
    };
    const findings = stpFindingsFor(stat);
    if (findings.length) flagged++;
    if (!opts.dryRun) {
      await reconcileIssues({
        districtId,
        scopeType: "school",
        scopeId: schoolId,
        source: "rule",
        findings,
      });
    }
  }

  return { schoolsEvaluated: evaluated, flagged };
}
