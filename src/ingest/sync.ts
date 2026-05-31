/**
 * SFTP sync CLI — the transport stage that feeds the ingester (DESIGN §4).
 * This is the entrypoint for the scheduled Container Apps Job:
 *
 *   npm run ingest:sync [-- --dry-run] [--force] [--limit N]
 *
 * Config now comes from the DB (ingest_settings, edited at /settings/ingestion),
 * decrypted with AUTH_SECRET. SFTP_* env vars are still honored as a fallback for
 * the old deploy-time path. The actual sync logic lives in sync-core.ts and is
 * shared with the web app's "Sync now" action.
 *
 * Required env (always): DATABASE_URL, AUTH_SECRET (to decrypt stored secrets).
 * Loaded from .env (dotenv) for local runs; injected from Key Vault in Azure.
 */
import "dotenv/config";

import { runSync, type SyncOptions } from "./sync-core";
import {
  resolveSftpConfig,
  markSyncStart,
  markSyncResult,
} from "../lib/ingest/settings";

function parseArgs(argv: string[]): SyncOptions {
  const a: SyncOptions = { dryRun: false, force: false, limit: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") a.dryRun = true;
    else if (arg === "--force") a.force = true;
    else if (arg === "--limit") {
      const n = Number(argv[++i]);
      a.limit = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    }
  }
  return a;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const args = parseArgs(process.argv.slice(2));

  const { enabled, config, source } = await resolveSftpConfig();
  if (!config) {
    console.log(
      "SFTP ingestion is not configured (no DB settings and no SFTP_* env). " +
        "Set it up at /settings/ingestion. Nothing to do.",
    );
    process.exit(0);
  }
  if (!enabled && !args.dryRun) {
    console.log("SFTP ingestion is disabled in settings; skipping. (use the UI to enable)");
    process.exit(0);
  }
  console.log(`Using SFTP config from ${source}.`);

  if (!args.dryRun) await markSyncStart();
  try {
    const summary = await runSync(config, args);
    if (!args.dryRun) {
      await markSyncResult(
        summary.failed > 0 ? "error" : "ok",
        `found=${summary.found} new=${summary.new} ingested=${summary.ingested} skipped=${summary.skipped} failed=${summary.failed}`,
      );
    }
    // Non-zero exit if any bundle failed, so the Job execution surfaces as failed.
    process.exit(summary.failed > 0 ? 1 : 0);
  } catch (err) {
    if (!args.dryRun) {
      await markSyncResult("error", (err as Error).message).catch(() => {});
    }
    throw err;
  }
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
