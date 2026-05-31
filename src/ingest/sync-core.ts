/**
 * Reusable SFTP-sync core (no CLI, no process.exit, no env reading). Both the
 * CLI Job (sync.ts) and the web app's "Sync now" action call runSync().
 *
 * One SFTP session per call: connect, walk the bundle tree, download every ZIP
 * not already parsed (the `ingested_bundles` table is the idempotency ledger),
 * extract, hand each extracted dir to ingestBundle(), then close. Tenancy comes
 * from each bundle's own scan.json, not the SFTP path.
 */
import { mkdtemp, rm, rename, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Client from "ssh2-sftp-client";
import AdmZip from "adm-zip";
import { eq } from "drizzle-orm";

import { db } from "../db";
import { ingestedBundles } from "../db/schema";
import { ingestBundle } from "./ingest";
import {
  isConfigBackupPath,
  configBackupStored,
  importConfigBackup,
} from "./config-backup";
import type { SftpConfig } from "../lib/ingest/settings";

export interface SyncOptions {
  dryRun?: boolean;
  force?: boolean;
  limit?: number | null;
}

export interface SyncSummary {
  found: number;
  new: number;
  ingested: number;
  skipped: number;
  failed: number;
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

type Logger = (line: string) => void;

/**
 * Run one sync pass. Returns a summary; never calls process.exit. `log` receives
 * human-readable progress lines (default: console.log).
 */
export async function runSync(
  cfg: SftpConfig,
  opts: SyncOptions = {},
  log: Logger = (l) => console.log(l),
): Promise<SyncSummary> {
  const force = !!opts.force;
  const limit = opts.limit ?? null;

  // Already-parsed filenames — skip re-downloading these (unless --force).
  const parsedRows = force
    ? []
    : await db
        .select({ filename: ingestedBundles.filename })
        .from(ingestedBundles)
        .where(eq(ingestedBundles.parseStatus, "parsed"));
  const parsed = new Set(parsedRows.map((r) => r.filename));

  const sftp = new Client();
  const summary: SyncSummary = { found: 0, new: 0, ingested: 0, skipped: 0, failed: 0 };

  try {
    await sftp.connect({
      host: cfg.host,
      port: cfg.port,
      username: cfg.username,
      password: cfg.password,
      privateKey: cfg.privateKey,
      passphrase: cfg.passphrase,
    });
    log(`Connected to ${cfg.host}:${cfg.port}; walking ${cfg.baseDir} …`);

    const allZips = await listZips(sftp, cfg.baseDir, 0);
    // Config backups (under _config/) are NOT scan bundles — route them aside.
    const configZips = allZips.filter((z) => isConfigBackupPath(z.path));
    const zips = allZips.filter((z) => !isConfigBackupPath(z.path));
    summary.found = zips.length;
    const fresh = zips.filter((z) => !parsed.has(z.name));
    summary.new = fresh.length;
    log(
      `Found ${zips.length} bundle(s); ${fresh.length} not yet parsed${
        force ? " (force: re-ingesting all)" : ""
      }. ${configZips.length} config backup(s) present.`,
    );

    // ---- config backups (store on the dashboard for review/restore) ----
    let configImported = 0;
    for (const c of configZips) {
      if (opts.dryRun) {
        log(`[dry-run] would store config backup ${c.path}`);
        continue;
      }
      try {
        if (!force && (await configBackupStored(c.path))) continue;
        const tmpc = await mkdtemp(join(tmpdir(), "netmon-cfg-"));
        try {
          const localZip = join(tmpc, c.name);
          await sftp.get(c.path, localZip);
          const res = await importConfigBackup(localZip, c.path);
          if (res === "imported") {
            configImported++;
            log(`  ⚙ stored config backup ${c.name}`);
          }
        } finally {
          await rm(tmpc, { recursive: true, force: true });
        }
      } catch (err) {
        log(`  ! config backup ${c.name} failed: ${(err as Error).message}`);
      }
    }
    if (configImported > 0) log(`Stored ${configImported} new config backup(s).`);

    const work = limit ? fresh.slice(0, limit) : fresh;

    for (const z of work) {
      if (opts.dryRun) {
        log(`[dry-run] would ingest ${z.path}`);
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

        const res = await ingestBundle(target, { force });
        if (res.skipped) {
          summary.skipped++;
          log(`  = ${z.name} already parsed (skipped)`);
        } else {
          summary.ingested++;
          log(
            `  + ${z.name} -> ${res.district}/${res.school}/${res.device} (${res.scans} scan(s))`,
          );
        }
      } catch (err) {
        summary.failed++;
        // Parse failure rolls back its own transaction (no ingested_bundles row),
        // so the bundle is retried on the next run — no silent data loss.
        log(`  ! ${z.name} failed: ${(err as Error).message}`);
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    }
  } finally {
    await sftp.end().catch(() => {});
  }

  log(
    `Done. found=${summary.found} new=${summary.new} ingested=${summary.ingested} skipped=${summary.skipped} failed=${summary.failed}`,
  );
  return summary;
}
