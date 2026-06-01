/**
 * CLI / cron entry: run the daily AI analysis for every district.
 *
 *   npm run ai:analyze            analyze all districts (last 24h window)
 *   npm run ai:analyze -- --district <slug>   just one district
 *
 * Deployed as a daily Azure Container Apps Job (see infra/main.bicep). Each
 * district fans out to every configured model provider; with no provider keys
 * set it no-ops cleanly (logs "no providers configured").
 *
 * DATABASE_URL + model keys come from .env locally and Key Vault in Azure. Must
 * load dotenv before importing anything that touches the DB.
 */
import "dotenv/config";

const ANALYSIS_WINDOW_MS = 24 * 60 * 60 * 1000;

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const onlySlug = typeof args.district === "string" ? args.district : null;

  // Imported after dotenv so DATABASE_URL is set when ../db evaluates.
  const { eq } = await import("drizzle-orm");
  const { db } = await import("@/db");
  const { districts } = await import("@/db/schema/app");
  const { runAnalysis } = await import("@/lib/ai/orchestrator");
  const { activeProviders } = await import("@/lib/ai/providers/registry");
  const { getAiSettings } = await import("@/lib/ai/settings");

  const settings = await getAiSettings();
  if (!settings.scheduleEnabled) {
    console.log("Scheduled AI analysis is disabled in Settings → AI analysis. Nothing to do.");
    process.exit(0);
  }

  const active = await activeProviders();
  if (active.length === 0) {
    console.log("No AI providers enabled/configured. Nothing to do.");
    process.exit(0);
  }
  console.log(`Active providers: ${active.map((a) => a.provider.id).join(", ")}`);

  const rows = await db
    .select({ id: districts.id, slug: districts.slug, name: districts.name })
    .from(districts)
    .where(onlySlug ? eq(districts.slug, onlySlug) : undefined)
    .orderBy(districts.name);

  if (rows.length === 0) {
    console.log(onlySlug ? `No district "${onlySlug}".` : "No districts to analyze.");
    process.exit(0);
  }

  const now = new Date();
  const window = { start: new Date(now.getTime() - ANALYSIS_WINDOW_MS), end: now };

  let ok = 0;
  let failed = 0;
  for (const d of rows) {
    try {
      const runId = await runAnalysis({
        scope: { type: "district", id: d.id, districtId: d.id, label: d.name || d.slug },
        window,
        trigger: "scheduled",
        requestedBy: null,
      });
      console.log(`✓ ${d.slug} → run ${runId}`);
      ok++;
    } catch (err) {
      console.error(`✗ ${d.slug}: ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(`Done. ${ok} ok, ${failed} failed, of ${rows.length} district(s).`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("AI analysis run failed:", err);
  process.exit(1);
});
