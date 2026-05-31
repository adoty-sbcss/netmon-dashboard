/**
 * SFTP sync — the transport stage that feeds the ingester (DESIGN §4).
 *
 *   npm run ingest:sync [-- --dry-run] [--force] [--limit N]
 *
 * One SFTP session per run: connect once, walk the bundle tree, download every
 * ZIP we haven't already parsed, extract it, hand the extracted directory to
 * ingestBundle(), then close. Idempotent on the ZIP filename (the
 * `ingested_bundles` table), so re-runs only pick up genuinely new bundles —
 * including boxes that were offline and backfilled.
 *
 * Tenancy (district/school/device) is derived from the bundle's own scan.json,
 * NOT the SFTP path, so a manually dropped ZIP ingests correctly too. We do not
 * pass path-based identity overrides.
 *
 * Flags:
 *   --dry-run   list what would be downloaded; touch nothing
 *   --force     re-ingest even bundles already marked parsed
 *   --limit N   stop after N bundles (safety valve for the first real run)
 *
 * Config (env / Key Vault secret refs in the cron Job):
 *   SFTP_HOST              required
 *   SFTP_PORT             default 22
 *   SFTP_USER              required
 *   SFTP_PASSWORD          password auth, OR
 *   SFTP_PRIVATE_KEY       PEM private-key contents (key auth), with optional
 *   SFTP_PASSPHRASE        passphrase for the key
 *   SFTP_BASE_DIR          tree root to walk (default "/")
 *   DATABASE_URL           the dashboard DB (same as the web app)
 *
 * DATABASE_URL is loaded from .env (dotenv) for local runs; in Azure it arrives
 * as an env var from a Key Vault secret. dotenv must load before ../db evaluates.
 */
import "dotenv/config";
import { mkdtemp, rm, rename, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Client from "ssh2-sftp-client";
import AdmZip from "adm-zip";

interface Args {
  dryRun: boolean;
  force: boolean;
  limit: number | null;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { dryRun: false, force: false, limit: null };
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

interface SftpConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  baseDir: string;
}

function readConfig(): SftpConfig {
  const host = process.env.SFTP_HOST;
  const username = process.env.SFTP_USER;
  const password = process.env.SFTP_PASSWORD || undefined;
  const privateKey = process.env.SFTP_PRIVATE_KEY || undefined;
  const missing: string[] = [];
  if (!host) missing.push("SFTP_HOST");
  if (!username) missing.push("SFTP_USER");
  if (!password && !privateKey) missing.push("SFTP_PASSWORD or SFTP_PRIVATE_KEY");
  if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");
  if (missing.length) {
    throw new Error(`Missing required config: ${missing.join(", ")}`);
  }
  return {
    host: host!,
    port: Number(process.env.SFTP_PORT) || 22,
    username: username!,
    password,
    privateKey,
    passphrase: process.env.SFTP_PASSPHRASE || undefined,
    baseDir: process.env.SFTP_BASE_DIR || "/",
  };
}

/** Cap on directory recursion depth — guards against symlink loops / odd trees. */
const MAX_WALK_DEPTH = 6;

interface RemoteZip {
  /** full remote path, e.g. /upload/sbcss/rch/northidf/northidf_2026_05_30_12.zip */
  path: string;
  /** filename, e.g. northidf_2026_05_30_12.zip (the idempotency key) */
  name: string;
}

/** Depth-first walk of the SFTP tree; collects every *.zip it finds. */
async function listZips(sftp: Client, dir: string, depth: number): Promise<RemoteZip[]> {
  if (depth > MAX_WALK_DEPTH) return [];
  const entries = await sftp.list(dir);
  const out: RemoteZip[] = [];
  for (const e of entries) {
    if (e.name === "." || e.name === "..") continue;
    const full = `${dir.replace(/\/+$/, "")}/${e.name}`;
    if (e.type === "d") {
      out.push(...(await listZips(sftp, full, depth + 1)));
    } else if (e.type === "-" && e.name.toLowerCase().endsWith(".zip")) {
      out.push({ path: full, name: e.name });
    }
  }
  return out;
}

/**
 * Find the bundle root inside an extraction dir. The collector's ZIPs put
 * `scans/` at the archive root, but tolerate a single wrapping folder too.
 */
async function findBundleRoot(extractDir: string): Promise<string> {
  if (existsSync(join(extractDir, "scans"))) return extractDir;
  const entries = await readdir(extractDir);
  const dirs: string[] = [];
  for (const name of entries) {
    const p = join(extractDir, name);
    if ((await stat(p)).isDirectory()) dirs.push(p);
  }
  for (const d of dirs) {
    if (existsSync(join(d, "scans"))) return d;
  }
  // No scans/ anywhere — return as-is so readBundleDir raises a clear error.
  return extractDir;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = readConfig();

  // Imported after dotenv so DATABASE_URL is set when ../db evaluates.
  const { db } = await import("../db");
  const { ingestedBundles } = await import("../db/schema");
  const { eq } = await import("drizzle-orm");
  const { ingestBundle } = await import("./ingest");

  // Already-parsed filenames — skip re-downloading these (unless --force).
  const parsedRows = args.force
    ? []
    : await db
        .select({ filename: ingestedBundles.filename })
        .from(ingestedBundles)
        .where(eq(ingestedBundles.parseStatus, "parsed"));
  const parsed = new Set(parsedRows.map((r) => r.filename));

  const sftp = new Client();
  const summary = { found: 0, new: 0, ingested: 0, skipped: 0, failed: 0 };

  try {
    await sftp.connect({
      host: cfg.host,
      port: cfg.port,
      username: cfg.username,
      password: cfg.password,
      privateKey: cfg.privateKey,
      passphrase: cfg.passphrase,
    });
    console.log(`Connected to ${cfg.host}:${cfg.port}; walking ${cfg.baseDir} …`);

    const zips = await listZips(sftp, cfg.baseDir, 0);
    summary.found = zips.length;
    const fresh = zips.filter((z) => !parsed.has(z.name));
    summary.new = fresh.length;
    console.log(
      `Found ${zips.length} bundle(s); ${fresh.length} not yet parsed${
        args.force ? " (force: re-ingesting all)" : ""
      }.`,
    );

    const work = args.limit ? fresh.slice(0, args.limit) : fresh;

    for (const z of work) {
      if (args.dryRun) {
        console.log(`[dry-run] would ingest ${z.path}`);
        continue;
      }
      const tmp = await mkdtemp(join(tmpdir(), "netmon-sync-"));
      try {
        const stem = z.name.replace(/\.zip$/i, "");
        const localZip = join(tmp, z.name);
        await sftp.get(z.path, localZip);

        const staging = join(tmp, "_extract");
        new AdmZip(localZip).extractAllTo(staging, true);
        const root = await findBundleRoot(staging);

        // Ensure the dir basename == the ZIP stem so ingestBundle's idempotency
        // key (derived from the dir name) matches the real filename.
        const target = join(tmp, stem);
        if (root !== target) await rename(root, target);

        const res = await ingestBundle(target, { force: args.force });
        if (res.skipped) {
          summary.skipped++;
          console.log(`  = ${z.name} already parsed (skipped)`);
        } else {
          summary.ingested++;
          console.log(
            `  + ${z.name} -> ${res.district}/${res.school}/${res.device} (${res.scans} scan(s))`,
          );
        }
      } catch (err) {
        summary.failed++;
        // Parse failure rolls back its own transaction (no ingested_bundles row),
        // so the bundle is retried on the next run — no silent data loss.
        console.error(`  ! ${z.name} failed: ${(err as Error).message}`);
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    }
  } finally {
    await sftp.end().catch(() => {});
  }

  console.log(
    `Done. found=${summary.found} new=${summary.new} ingested=${summary.ingested} skipped=${summary.skipped} failed=${summary.failed}`,
  );
  // Non-zero exit if any bundle failed, so the Job execution surfaces as failed.
  process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
