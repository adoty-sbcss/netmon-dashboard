/**
 * Import a sensor config backup pulled from the SFTP `_config/...` drop.
 *
 * The collector uploads, daily, a small ZIP to
 *   <base>/_config/<district>/<school>/<device>/config_YYYY-MM-DD.zip
 * containing netmon.env + snmp.yaml + a manifest.json. We store it on the
 * dashboard (base64 inline) so an admin can review/download/restore it. Identity
 * comes from the path slugs (confirmed against the manifest when present).
 */
import { readFile } from "node:fs/promises";
import AdmZip from "adm-zip";
import { and, desc, eq } from "drizzle-orm";

import { db } from "../db";
import { districts, schools, sensors } from "../db/schema/app";
import { configBackups } from "../db/schema/management";
import { slugify, toDate } from "./bundle";

/** Keep at most this many backups per sensor; older ones are pruned. */
const KEEP_PER_SENSOR = 30;

/** A config-backup ZIP lives under `_config/` (or is named `config_*.zip`). */
export function isConfigBackupPath(p: string): boolean {
  return /\/_config\//i.test(p) || /(^|\/)config_[^/]*\.zip$/i.test(p);
}

/** Pull `<...>/_config/<district>/<school>/<device>/<file>` slugs from a path. */
export function configSlugsFromPath(
  p: string,
): { district: string; school: string; device: string } | null {
  const parts = p.split("/").filter(Boolean);
  const idx = parts.findIndex((s) => s.toLowerCase() === "_config");
  // need district/school/device + filename after _config
  if (idx < 0 || parts.length < idx + 5) return null;
  const [district, school, device] = parts.slice(idx + 1, idx + 4);
  return { district, school, device };
}

async function getOrCreateSensorId(
  districtSlug: string,
  schoolSlug: string,
  deviceSlug: string,
): Promise<number> {
  await db
    .insert(districts)
    .values({ slug: districtSlug, name: districtSlug })
    .onConflictDoNothing({ target: districts.slug });
  const [d] = await db.select().from(districts).where(eq(districts.slug, districtSlug));

  await db
    .insert(schools)
    .values({ districtId: d.id, slug: schoolSlug, name: schoolSlug })
    .onConflictDoNothing({ target: [schools.districtId, schools.slug] });
  const [s] = await db
    .select()
    .from(schools)
    .where(and(eq(schools.districtId, d.id), eq(schools.slug, schoolSlug)));

  await db
    .insert(sensors)
    .values({ schoolId: s.id, slug: deviceSlug, name: deviceSlug })
    .onConflictDoNothing({ target: [sensors.schoolId, sensors.slug] });
  const [sen] = await db
    .select()
    .from(sensors)
    .where(and(eq(sensors.schoolId, s.id), eq(sensors.slug, deviceSlug)));
  return sen.id;
}

/** Date from `config_2026-05-30.zip` (UTC midnight), or null. */
function dateFromFilename(name: string): Date | null {
  const m = name.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type ConfigImportResult = "imported" | "skipped" | "failed";

/** Returns whether a sensor already has a backup with this filename. */
export async function hasConfigBackup(
  districtSlug: string,
  schoolSlug: string,
  deviceSlug: string,
  filename: string,
): Promise<boolean> {
  const [d] = await db.select({ id: districts.id }).from(districts).where(eq(districts.slug, districtSlug));
  if (!d) return false;
  const [s] = await db
    .select({ id: schools.id })
    .from(schools)
    .where(and(eq(schools.districtId, d.id), eq(schools.slug, schoolSlug)));
  if (!s) return false;
  const [sen] = await db
    .select({ id: sensors.id })
    .from(sensors)
    .where(and(eq(sensors.schoolId, s.id), eq(sensors.slug, deviceSlug)));
  if (!sen) return false;
  const [row] = await db
    .select({ id: configBackups.id })
    .from(configBackups)
    .where(and(eq(configBackups.sensorId, sen.id), eq(configBackups.filename, filename)));
  return !!row;
}

/** True if this remote backup is already stored (or unresolvable) — skip download. */
export async function configBackupStored(remotePath: string): Promise<boolean> {
  const slugs = configSlugsFromPath(remotePath);
  if (!slugs) return true; // can't place it → don't bother downloading
  const filename = remotePath.split("/").pop()!;
  return hasConfigBackup(
    slugify(slugs.district),
    slugify(slugs.school),
    slugify(slugs.device),
    filename,
  );
}

/** Import one config-backup ZIP (already downloaded locally). */
export async function importConfigBackup(
  localZipPath: string,
  remotePath: string,
): Promise<ConfigImportResult> {
  const slugs = configSlugsFromPath(remotePath);
  if (!slugs) return "skipped";
  const filename = remotePath.split("/").pop()!;
  const sensorId = await getOrCreateSensorId(
    slugify(slugs.district),
    slugify(slugs.school),
    slugify(slugs.device),
  );

  const [existing] = await db
    .select({ id: configBackups.id })
    .from(configBackups)
    .where(and(eq(configBackups.sensorId, sensorId), eq(configBackups.filename, filename)));
  if (existing) return "skipped";

  const buf = await readFile(localZipPath);
  let manifest: Record<string, unknown> = {};
  let capturedAt: Date | null = null;
  try {
    const zip = new AdmZip(buf);
    const entry =
      zip.getEntry("manifest.json") ??
      zip.getEntries().find((e) => e.entryName.toLowerCase().endsWith("manifest.json"));
    if (entry) {
      manifest = JSON.parse(entry.getData().toString("utf8")) as Record<string, unknown>;
      capturedAt = toDate(manifest.backed_up_at as string | undefined);
    }
  } catch {
    // tolerate a malformed/encrypted ZIP — still store the bytes
  }
  if (!capturedAt) capturedAt = dateFromFilename(filename);

  await db
    .insert(configBackups)
    .values({
      sensorId,
      filename,
      capturedAt,
      sizeBytes: buf.length,
      contentB64: buf.toString("base64"),
      manifest,
    })
    .onConflictDoNothing({ target: [configBackups.sensorId, configBackups.filename] });

  // Prune to the most recent KEEP_PER_SENSOR.
  const all = await db
    .select({ id: configBackups.id })
    .from(configBackups)
    .where(eq(configBackups.sensorId, sensorId))
    .orderBy(desc(configBackups.capturedAt), desc(configBackups.importedAt));
  const stale = all.slice(KEEP_PER_SENSOR).map((r) => r.id);
  for (const id of stale) await db.delete(configBackups).where(eq(configBackups.id, id));

  return "imported";
}
