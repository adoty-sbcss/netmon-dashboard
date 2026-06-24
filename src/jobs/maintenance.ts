/**
 * Maintenance cron Job (daily) — keep the database + SFTP server from growing
 * without bound, and run the deterministic (non-AI) checks. Four best-effort
 * steps, each isolated so one failing doesn't abort the others:
 *
 *   1. Purge per-scan TIME-SERIES older than RETENTION_DAYS by deleting old
 *      scan_runs; the FK cascade removes devices / neighbors / dhcp / dns / stp /
 *      traffic / snmp / findings for those scans. The DURABLE tier (entities,
 *      topology snapshots, daily rollups, AI analyses, issues) is untouched, as
 *      are iperf_results + security_events (kept for their own history).
 *   2. Deterministic RULES → Issues tracker. Currently the STP-instability rule
 *      (frequent topology changes); reconciled under source 'rule' so it dedupes
 *      + auto-resolves like the AI findings, but runs with NO dependency on AI
 *      provider keys. A 24h-window evaluation suits the daily cadence; it reads
 *      recent data so it's unaffected by step 1's 30-day purge.
 *   3. VACUUM (ANALYZE) to reclaim the freed space + refresh planner stats.
 *   4. Prune already-ingested bundles from the SFTP server (parsed AND older than
 *      SFTP_GRACE_DAYS). They're archived to Blob, so this only frees the server;
 *      the ingested_bundles bookkeeping rows are kept.
 *
 * Env:
 *   DATABASE_URL, AUTH_SECRET    required (AUTH_SECRET decrypts the SFTP creds)
 *   RETENTION_DAYS   (default 30) per-scan time-series age cutoff
 *   SFTP_GRACE_DAYS  (default 7)  min age after parse before pruning from SFTP
 *   MAINTENANCE_DRY_RUN=1         log what WOULD happen; touch nothing
 *
 * Entrypoint for the w2-sbcss-netmon-maintenance Container Apps Job. Run via:
 *   az containerapp job start -g <rg> -n w2-sbcss-netmon-maintenance
 */
import "dotenv/config";

import Client from "ssh2-sftp-client";
import postgres from "postgres";
import { and, eq, inArray, isNotNull, lt, notInArray, sql } from "drizzle-orm";

import { db } from "../db";
import { scanRuns, hostSwitchPorts, dnsProbes, networkReachability } from "../db/schema/netmon";
import { districts, ingestedBundles } from "../db/schema/app";
import { resolveSftpConfig } from "../lib/ingest/settings";
import { evaluateStpRules } from "../lib/rules/stp";

function intEnv(name: string, dflt: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
}

const RETENTION_DAYS = intEnv("RETENTION_DAYS", 30);
// High-volume tables the app only ever reads at their NEWEST scan (FDB / DNS
// probes / reachability) are trimmed to this shorter window instead of 30d.
const SHORT_RETENTION_DAYS = intEnv("SHORT_RETENTION_DAYS", 7);
const SFTP_GRACE_DAYS = intEnv("SFTP_GRACE_DAYS", 7);
const DRY_RUN = process.env.MAINTENANCE_DRY_RUN === "1";
const DAY_MS = 24 * 60 * 60 * 1000;

const MAX_WALK_DEPTH = 6;

/** Depth-first walk collecting every *.zip full path (mirrors sync-core.listZips). */
async function listZips(sftp: Client, dir: string, depth: number): Promise<string[]> {
  if (depth > MAX_WALK_DEPTH) return [];
  let entries;
  try {
    entries = await sftp.list(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (e.name === "." || e.name === "..") continue;
    const full = `${dir.replace(/\/+$/, "")}/${e.name}`;
    if (e.type === "d") out.push(...(await listZips(sftp, full, depth + 1)));
    else if (e.type === "-" && e.name.toLowerCase().endsWith(".zip")) out.push(full);
  }
  return out;
}

// Trailing tenancy key district/school/device/file — matches an ingested_bundles row.
const pathKey = (p: string) => p.split("/").filter(Boolean).slice(-4).join("/");

/** Step 1: delete scan_runs (+ cascaded per-scan time-series) past the window. */
async function purgeTimeSeries(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * DAY_MS);
  // Retention clock = ingested_at (NOT NULL, monotonic — when the data entered our
  // system). A TYPED column comparison so the Date binds via the column's mapper;
  // a bare Date embedded in a raw sql fragment fails (postgres-js can't serialize
  // it without the column type). started_at is nullable, ingested_at isn't, and
  // for hourly-ingested bundles the two are within minutes anyway.
  //
  // Demo districts are spared: their data is seeded once and must persist so the
  // demo doesn't hollow out after RETENTION_DAYS. scan_runs carry the district
  // slug, so exclude any slug flagged is_demo.
  const demoSlugs = (
    await db.select({ slug: districts.slug }).from(districts).where(eq(districts.isDemo, true))
  ).map((r) => r.slug);
  const where =
    demoSlugs.length > 0
      ? and(lt(scanRuns.ingestedAt, cutoff), notInArray(scanRuns.districtSlug, demoSlugs))
      : lt(scanRuns.ingestedAt, cutoff);
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(scanRuns).where(where);
  const n = row?.n ?? 0;
  if (DRY_RUN) {
    console.log(`[dry-run] would purge ${n} scan_run(s) older than ${RETENTION_DAYS}d (cascades time-series).`);
    return;
  }
  if (n === 0) {
    console.log(`Time-series purge: nothing older than ${RETENTION_DAYS}d.`);
    return;
  }
  await db.delete(scanRuns).where(where);
  console.log(`Time-series purge: deleted ${n} scan_run(s) older than ${RETENTION_DAYS}d (cascaded their per-scan rows).`);
}

/**
 * Step 1b: trim the high-volume, latest-scan-only tables (FDB host_switch_ports /
 * dns_probes / network_reachability) to a SHORTER window than the global 30d. The
 * app reads each only at its newest scan, so older rows are pure bloat. Deletes by
 * scan age WITHOUT removing scan_runs, so the 30d tier (devices/neighbors/snmp/…)
 * is untouched. Demo districts are spared, same as the main purge.
 */
async function purgeShortRetention(): Promise<void> {
  if (SHORT_RETENTION_DAYS >= RETENTION_DAYS) {
    console.log(
      `Short-retention trim: SHORT_RETENTION_DAYS=${SHORT_RETENTION_DAYS} not below RETENTION_DAYS=${RETENTION_DAYS}; skipping.`,
    );
    return;
  }
  const cutoff = new Date(Date.now() - SHORT_RETENTION_DAYS * DAY_MS);
  const demoSlugs = (
    await db.select({ slug: districts.slug }).from(districts).where(eq(districts.isDemo, true))
  ).map((r) => r.slug);
  const scanWhere =
    demoSlugs.length > 0
      ? and(lt(scanRuns.ingestedAt, cutoff), notInArray(scanRuns.districtSlug, demoSlugs))
      : lt(scanRuns.ingestedAt, cutoff);
  const oldScanIds = db.select({ id: scanRuns.id }).from(scanRuns).where(scanWhere);

  if (DRY_RUN) {
    console.log(
      `[dry-run] would trim host_switch_ports / dns_probes / network_reachability older than ${SHORT_RETENTION_DAYS}d (keeps scan_runs).`,
    );
    return;
  }
  await db.delete(hostSwitchPorts).where(inArray(hostSwitchPorts.scanRunId, oldScanIds));
  await db.delete(dnsProbes).where(inArray(dnsProbes.scanRunId, oldScanIds));
  await db.delete(networkReachability).where(inArray(networkReachability.scanRunId, oldScanIds));
  console.log(
    `Short-retention trim: trimmed host_switch_ports / dns_probes / network_reachability older than ${SHORT_RETENTION_DAYS}d.`,
  );
}

/** Step 2: deterministic rules → Issues tracker (STP instability for now). */
async function deterministicRules(): Promise<void> {
  const { schoolsEvaluated, tcFlagged, rootFlagged } = await evaluateStpRules({ dryRun: DRY_RUN });
  console.log(
    `${DRY_RUN ? "[dry-run] " : ""}Deterministic rules: evaluated ${schoolsEvaluated} school(s); ` +
      `${tcFlagged} with frequent STP topology changes, ${rootFlagged} with a changed root bridge` +
      `${DRY_RUN ? " (no issues written)" : ""}.`,
  );
}

/** Step 3: VACUUM (ANALYZE). Runs on a dedicated simple-protocol connection —
 *  VACUUM can't run inside a transaction or a prepared statement. */
async function vacuum(): Promise<void> {
  if (DRY_RUN) {
    console.log("[dry-run] would run VACUUM (ANALYZE).");
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) return;
  const client = postgres(url, { max: 1, prepare: false });
  try {
    await client.unsafe("VACUUM (ANALYZE)");
    console.log("VACUUM (ANALYZE) complete.");
  } finally {
    await client.end({ timeout: 5 }).catch(() => {});
  }
}

/** Step 4: delete already-ingested, aged bundles from the SFTP server. */
async function pruneSftp(): Promise<void> {
  const cutoff = new Date(Date.now() - SFTP_GRACE_DAYS * DAY_MS);
  const rows = await db
    .select({
      districtSlug: ingestedBundles.districtSlug,
      schoolSlug: ingestedBundles.schoolSlug,
      deviceSlug: ingestedBundles.deviceSlug,
      filename: ingestedBundles.filename,
    })
    .from(ingestedBundles)
    .where(
      and(
        eq(ingestedBundles.parseStatus, "parsed"),
        isNotNull(ingestedBundles.parsedAt),
        lt(ingestedBundles.parsedAt, cutoff),
      ),
    );
  if (rows.length === 0) {
    console.log(`SFTP prune: no parsed bundles older than ${SFTP_GRACE_DAYS}d.`);
    return;
  }
  const pruneKeys = new Set(
    rows.map((r) => `${r.districtSlug}/${r.schoolSlug}/${r.deviceSlug}/${r.filename}`),
  );

  const { config, source } = await resolveSftpConfig();
  if (!config) {
    console.log("SFTP prune: no SFTP config — skipping (set it in Settings → SFTP ingestion).");
    return;
  }
  console.log(`SFTP prune: ${rows.length} parsed+aged candidate(s); using config from ${source}.`);

  const sftp = new Client();
  let deleted = 0;
  let failed = 0;
  try {
    await sftp.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      privateKey: config.privateKey,
      passphrase: config.passphrase,
    });
    // Match by walking the real tree, so we only delete files that actually exist
    // AND correspond to a parsed+aged bundle — never reconstruct/guess a path.
    const allZips = await listZips(sftp, config.baseDir, 0);
    const toDelete = allZips.filter((p) => pruneKeys.has(pathKey(p)));
    console.log(`SFTP prune: ${toDelete.length} of ${allZips.length} remote ZIP(s) match the prune set.`);
    for (const p of toDelete) {
      if (DRY_RUN) {
        console.log(`[dry-run] would delete ${p}`);
        deleted++;
        continue;
      }
      try {
        await sftp.delete(p);
        deleted++;
      } catch (e) {
        failed++;
        console.log(`  ! delete failed ${p}: ${(e as Error).message}`);
      }
    }
  } finally {
    await sftp.end().catch(() => {});
  }
  console.log(`SFTP prune: ${DRY_RUN ? "[dry-run] " : ""}deleted ${deleted}, failed ${failed}.`);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  console.log(
    `Maintenance start — retention=${RETENTION_DAYS}d sftpGrace=${SFTP_GRACE_DAYS}d dryRun=${DRY_RUN}.`,
  );

  let hadError = false;
  const step = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      hadError = true;
      const err = e as Error & { cause?: unknown };
      console.error(`✗ ${label}: ${err.message}`);
      if (err.cause) {
        const c = err.cause;
        console.error(`   cause: ${c instanceof Error ? c.message : String(c)}`);
      }
    }
  };

  await step("time-series purge", purgeTimeSeries);
  await step("short-retention trim", purgeShortRetention);
  await step("deterministic rules", deterministicRules);
  await step("vacuum", vacuum);
  await step("sftp prune", pruneSftp);

  console.log(`Maintenance done${hadError ? " (with errors)" : ""}.`);
  process.exit(hadError ? 1 : 0);
}

main().catch((err) => {
  console.error("Maintenance failed:", err);
  process.exit(1);
});
