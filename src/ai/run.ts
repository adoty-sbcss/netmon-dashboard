/**
 * CLI / cron entry: run the AI analysis sweep.
 *
 *   npm run ai:analyze                          due districts + their schools
 *   npm run ai:analyze -- --district <slug>     just one district
 *   npm run ai:analyze -- --force               ignore the schedule gate, run now
 *
 * Deployed as a Container Apps Job (see infra/main.bicep) that WAKES HOURLY. Each
 * wake it checks the IN-APP schedule (ai_settings.schedule_cron, edited at
 * /settings/ai) and only proceeds when that schedule is due — so admins change
 * the run time/cadence in the UI without a redeploy. The same "wake often, gate
 * in code" pattern as src/ingest/sync.ts.
 *
 * A due sweep covers, for every district:
 *   - the district-wide general (health) analysis,
 *   - each school's general analysis        (AI_SCHOOL_GENERAL=0 to skip),
 *   - each school's physical-topology review (AI_TOPOLOGY=0 to skip).
 * School passes run sequentially with a small throttle (AI_THROTTLE_MS) so we
 * spread token usage across the provider's per-minute limit and don't trip 429s.
 *
 * With no provider keys set it no-ops cleanly. DATABASE_URL + model keys come from
 * .env locally and Key Vault in Azure. dotenv must load before anything touches
 * the DB.
 */
import "dotenv/config";

const ANALYSIS_WINDOW_MS = 24 * 60 * 60 * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  // Env escape hatch for the Container App job, where CLI flags are awkward.
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
    // Honor the in-app cron. The Job wakes hourly; we decide if the user's
    // schedule is due by comparing its last fire time to the last scheduled run.
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
    console.log("Forced run (schedule gate bypassed).");
  }

  const active = await activeProviders();
  if (active.length === 0) {
    console.log("No AI providers enabled/configured. Nothing to do.");
    process.exit(0);
  }
  console.log(`Active providers: ${active.map((a) => a.provider.id).join(", ")}`);

  // --- Coverage knobs (default: full). Set to "0" in the Job env to trim. -----
  const doSchoolGeneral = process.env.AI_SCHOOL_GENERAL !== "0";
  const doTopology = process.env.AI_TOPOLOGY !== "0";
  const throttleMs = Number(process.env.AI_THROTTLE_MS) || 1500;

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
    district: { ok: 0, failed: 0 },
    school: { ok: 0, failed: 0 },
    topology: { ok: 0, failed: 0 },
  };

  for (const d of districtRows) {
    const districtLabel = d.name || d.slug;

    // 1) District-wide general (health) analysis.
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

    if (!doSchoolGeneral && !doTopology) continue;

    // 2) Per-school passes — only schools that have scan data (skip empty ones to
    //    save spend). Sequential + throttled to spread load and avoid 429s.
    const schools = (await listSchools(d.id)).filter((s) => s.lastScanAt != null);
    for (const s of schools) {
      const schoolLabel = `${districtLabel} — ${s.name || s.slug}`;

      if (doSchoolGeneral) {
        try {
          const runId = await runAnalysis({
            scope: { type: "school", id: s.id, districtId: d.id, label: schoolLabel },
            window,
            trigger: "scheduled",
            requestedBy: null,
          });
          console.log(`  ✓ school ${s.slug} (general) → run ${runId}`);
          tally.school.ok++;
        } catch (err) {
          console.error(`  ✗ school ${s.slug} (general): ${(err as Error).message}`);
          tally.school.failed++;
        }
        await sleep(throttleMs);
      }

      if (doTopology) {
        try {
          const runId = await runTopologyAnalysis({
            schoolId: s.id,
            districtId: d.id,
            label: schoolLabel,
            trigger: "scheduled",
            requestedBy: null,
          });
          console.log(`  ✓ school ${s.slug} (topology) → run ${runId}`);
          tally.topology.ok++;
        } catch (err) {
          console.error(`  ✗ school ${s.slug} (topology): ${(err as Error).message}`);
          tally.topology.failed++;
        }
        await sleep(throttleMs);
      }
    }
  }

  const failed = tally.district.failed + tally.school.failed + tally.topology.failed;
  console.log(
    `Done. district ${tally.district.ok}/${tally.district.ok + tally.district.failed}, ` +
      `school-general ${tally.school.ok}/${tally.school.ok + tally.school.failed}, ` +
      `topology ${tally.topology.ok}/${tally.topology.ok + tally.topology.failed}.`,
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("AI analysis run failed:", err);
  process.exit(1);
});
