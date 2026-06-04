/**
 * CLI / cron entry: run the AI analysis sweep.
 *
 *   npm run ai:analyze                          due districts + changed schools
 *   npm run ai:analyze -- --district <slug>     just one district
 *   npm run ai:analyze -- --force               ignore schedule + change gates
 *
 * Deployed as a Container Apps Job (see infra/main.bicep) that WAKES HOURLY. Each
 * wake it checks the IN-APP schedule (ai_settings.schedule_cron, edited at
 * /settings/ai) and only proceeds when that schedule is due — so admins change
 * the run time/cadence in the UI without a redeploy.
 *
 * SCALING (built for hundreds of schools):
 *   - INCREMENTAL: a scope is analyzed only when its data changed since the last
 *     SUCCESSFUL run (school.lastScanAt > last ok analysis). Unchanged scopes are
 *     skipped; 429'd scopes stay "due" and retry on a later wake.
 *   - PER-RUN CAP (AI_MAX_SCHOOLS_PER_RUN, default 40): each execution processes
 *     at most N schools, stalest first; the rest drain over subsequent hourly
 *     wakes. Keeps any single run bounded in time and API volume.
 *   - PACING: every model call goes through src/lib/ai/limiter.ts (concurrency
 *     gate + adaptive Retry-After cooldown), so the sweep stays under the Azure
 *     OpenAI TPM quota instead of bursting into 429s.
 *
 * Coverage toggles: AI_SCHOOL_GENERAL=0 / AI_TOPOLOGY=0 skip those passes.
 * With no provider keys set the whole thing no-ops cleanly.
 */
import "dotenv/config";

const ANALYSIS_WINDOW_MS = 24 * 60 * 60 * 1000;

function parseArgs(argv: string[]): { district: string | null; force: boolean } {
  let district: string | null = null;
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--district") {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        district = next;
        i++;
      }
    } else if (a === "--force") {
      force = true;
    }
  }
  if (process.env.AI_FORCE === "1") force = true;
  return { district, force };
}

async function main() {
  const { district: onlySlug, force } = parseArgs(process.argv.slice(2));

  // Imported after dotenv so DATABASE_URL is set when ../db evaluates.
  const { eq, max } = await import("drizzle-orm");
  const { db } = await import("@/db");
  const { districts } = await import("@/db/schema/app");
  const { aiAnalyses } = await import("@/db/schema/ai");
  const { runAnalysis } = await import("@/lib/ai/orchestrator");
  const { runTopologyAnalysis } = await import("@/lib/ai/topology");
  const { activeProviders } = await import("@/lib/ai/providers/registry");
  const { getAiSettings } = await import("@/lib/ai/settings");
  const { isScheduledRunDue } = await import("@/lib/ai/cron");
  const { listSchools } = await import("@/db/queries");
  const { getLastSuccessfulAnalysisMap } = await import("@/lib/ai/queries");

  const settings = await getAiSettings();
  const now = new Date();

  // --- Schedule gate (skipped by --force / AI_FORCE=1) -----------------------
  if (!force) {
    if (!settings.scheduleEnabled) {
      console.log(
        "Scheduled AI analysis is OFF in Settings → AI analysis. Nothing to do. " +
          "(use --force / AI_FORCE=1 to run anyway)",
      );
      process.exit(0);
    }
    const [row] = await db
      .select({ last: max(aiAnalyses.createdAt) })
      .from(aiAnalyses)
      .where(eq(aiAnalyses.trigger, "scheduled"));
    const lastRun = row?.last ? new Date(row.last) : null;
    if (!isScheduledRunDue(settings.scheduleCron, now, lastRun)) {
      console.log(
        `Not due yet (schedule "${settings.scheduleCron}", UTC). Last scheduled run: ` +
          `${lastRun ? lastRun.toISOString() : "never"}. Skipping this wake.`,
      );
      process.exit(0);
    }
    console.log(`Scheduled run due (schedule "${settings.scheduleCron}", UTC).`);
  } else {
    console.log("Forced run (schedule + change gates bypassed).");
  }

  const active = await activeProviders();
  if (active.length === 0) {
    console.log("No AI providers enabled/configured. Nothing to do.");
    process.exit(0);
  }
  console.log(`Active providers: ${active.map((a) => a.provider.id).join(", ")}`);

  // --- Coverage + scaling knobs ----------------------------------------------
  const doSchoolGeneral = process.env.AI_SCHOOL_GENERAL !== "0";
  const doTopology = process.env.AI_TOPOLOGY !== "0";
  const maxSchoolsPerRun = Math.max(1, Number(process.env.AI_MAX_SCHOOLS_PER_RUN) || 40);

  const window = { start: new Date(now.getTime() - ANALYSIS_WINDOW_MS), end: now };

  const districtRows = await db
    .select({ id: districts.id, slug: districts.slug, name: districts.name })
    .from(districts)
    .where(onlySlug ? eq(districts.slug, onlySlug) : undefined)
    .orderBy(districts.name);

  if (districtRows.length === 0) {
    console.log(onlySlug ? `No district "${onlySlug}".` : "No districts to analyze.");
    process.exit(0);
  }

  const tally = {
    district: { ok: 0, failed: 0, skipped: 0 },
    school: { ok: 0, failed: 0, skipped: 0 },
    topology: { ok: 0, failed: 0, skipped: 0 },
    deferred: 0,
  };

  // newer(a, b): true when scan time `a` is strictly after last-success `b`
  // (or there's no prior success). `force` makes everything due.
  const due = (lastScanAt: Date | null, lastOk: Date | undefined): boolean =>
    force || !lastOk || (lastScanAt != null && lastScanAt.getTime() > lastOk.getTime());

  for (const d of districtRows) {
    const districtLabel = d.name || d.slug;
    const lastOk = await getLastSuccessfulAnalysisMap(d.id);

    // Only schools with scan data are analyzable.
    const schools = (await listSchools(d.id)).filter((s) => s.lastScanAt != null);

    // 1) District-wide general — run if any school changed since its last success.
    const districtLastOk = lastOk.get(`district:${d.id}:general`);
    const districtChanged = schools.some((s) => due(s.lastScanAt, districtLastOk));
    if (districtChanged) {
      try {
        const runId = await runAnalysis({
          scope: { type: "district", id: d.id, districtId: d.id, label: districtLabel },
          window,
          trigger: "scheduled",
          requestedBy: null,
        });
        console.log(`✓ district ${d.slug} → run ${runId}`);
        tally.district.ok++;
      } catch (err) {
        console.error(`✗ district ${d.slug}: ${(err as Error).message}`);
        tally.district.failed++;
      }
    } else {
      tally.district.skipped++;
    }

    if (!doSchoolGeneral && !doTopology) continue;

    // 2) Per-school passes — pick only the scopes that changed, then cap how many
    //    schools we touch this wake (stalest first), deferring the rest.
    const candidates = schools
      .map((s) => {
        const gOk = lastOk.get(`school:${s.id}:general`);
        const tOk = lastOk.get(`school:${s.id}:topology`);
        const dueGen = doSchoolGeneral && due(s.lastScanAt, gOk);
        const dueTopo = doTopology && due(s.lastScanAt, tOk);
        // Stalest first: never-analyzed (0) before oldest-analyzed.
        const staleness = Math.min(gOk?.getTime() ?? 0, tOk?.getTime() ?? 0);
        return { s, dueGen, dueTopo, staleness };
      })
      .filter((c) => c.dueGen || c.dueTopo);

    // Count the scopes we're NOT running because they're unchanged.
    tally.school.skipped += schools.filter(
      (s) => doSchoolGeneral && !due(s.lastScanAt, lastOk.get(`school:${s.id}:general`)),
    ).length;
    tally.topology.skipped += schools.filter(
      (s) => doTopology && !due(s.lastScanAt, lastOk.get(`school:${s.id}:topology`)),
    ).length;

    candidates.sort((a, b) => a.staleness - b.staleness);
    const toRun = candidates.slice(0, maxSchoolsPerRun);
    const deferred = candidates.length - toRun.length;
    if (deferred > 0) {
      tally.deferred += deferred;
      console.log(
        `  district ${d.slug}: ${deferred} changed school(s) deferred to a later ` +
          `wake (cap ${maxSchoolsPerRun}/run).`,
      );
    }

    for (const c of toRun) {
      const schoolLabel = `${districtLabel} — ${c.s.name || c.s.slug}`;
      if (c.dueGen) {
        try {
          const runId = await runAnalysis({
            scope: { type: "school", id: c.s.id, districtId: d.id, label: schoolLabel },
            window,
            trigger: "scheduled",
            requestedBy: null,
          });
          console.log(`  ✓ school ${c.s.slug} (general) → run ${runId}`);
          tally.school.ok++;
        } catch (err) {
          console.error(`  ✗ school ${c.s.slug} (general): ${(err as Error).message}`);
          tally.school.failed++;
        }
      }
      if (c.dueTopo) {
        try {
          const runId = await runTopologyAnalysis({
            schoolId: c.s.id,
            districtId: d.id,
            label: schoolLabel,
            trigger: "scheduled",
            requestedBy: null,
          });
          console.log(`  ✓ school ${c.s.slug} (topology) → run ${runId}`);
          tally.topology.ok++;
        } catch (err) {
          console.error(`  ✗ school ${c.s.slug} (topology): ${(err as Error).message}`);
          tally.topology.failed++;
        }
      }
    }
  }

  const failed = tally.district.failed + tally.school.failed + tally.topology.failed;
  console.log(
    `Done. district ok=${tally.district.ok} failed=${tally.district.failed} skipped=${tally.district.skipped}; ` +
      `school-general ok=${tally.school.ok} failed=${tally.school.failed} skipped=${tally.school.skipped}; ` +
      `topology ok=${tally.topology.ok} failed=${tally.topology.failed} skipped=${tally.topology.skipped}; ` +
      `deferred=${tally.deferred}.`,
  );

  // --- Device-type AI adjudication (the low-confidence classification tail) ---
  // Only escalates ambiguous devices, caches by signalHash, and shares the same
  // limiter as the sweep above. Set AI_CLASSIFY=0 to skip it.
  if (process.env.AI_CLASSIFY !== "0") {
    try {
      const { adjudicateClassifications } = await import("@/lib/classify/adjudicate");
      const { aiComplete } = await import("@/lib/ai/complete");
      const { getAiUsageThisMonth } = await import("@/lib/ai/queries");

      // Advisory monthly-cap gate (cost computed once; classification calls are
      // tiny and aren't separately metered, so this is a coarse guard).
      let withinBudget: () => boolean = () => true;
      if (settings.monthlySpendCapUsd != null) {
        const cap = settings.monthlySpendCapUsd;
        const usage = await getAiUsageThisMonth();
        const spent = usage.reduce((a, u) => a + u.costUsd, 0);
        withinBudget = () => spent < cap;
      }

      const cl = await adjudicateClassifications({
        callModel: (p) => aiComplete(p).then((r) => r.text),
        withinBudget,
        limit: Number(process.env.AI_CLASSIFY_LIMIT) || 200,
      });
      console.log(
        `Classification: examined=${cl.examined} adjudicated=${cl.adjudicated} ` +
          `cached=${cl.cached} skippedBudget=${cl.skippedBudget} failed=${cl.failed}.`,
      );
    } catch (err) {
      console.error(`Classification adjudication skipped: ${(err as Error).message}`);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("AI analysis run failed:", err);
  process.exit(1);
});
