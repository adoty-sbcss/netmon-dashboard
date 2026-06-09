"use server";

/**
 * Superadmin data-management actions: rename, delete, and date-range purge of
 * districts / schools / sensors (IDFs). All are superadmin-gated and audited.
 *
 * Rename is name-only: the slug is the stable key NetMon bundles map to, and
 * get-or-create uses onConflictDoNothing, so the friendly name persists and new
 * data for that slug keeps landing in the (renamed) entity automatically.
 *
 * Deletes rely on the FK cascade (district→school→sensor→scan_runs→time-series,
 * plus entities/rollups by district) and additionally clear topology_snapshots,
 * which have no FK.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, gte, inArray, lte } from "drizzle-orm";

import { db } from "@/db";
import {
  districts,
  schools,
  sensors,
  auditLog,
} from "@/db/schema/app";
import { scanRuns } from "@/db/schema/netmon";
import {
  topologySnapshots,
  topologyPositions,
  entitiesSwitch,
  entitiesHost,
  healthRollupDaily,
} from "@/db/schema/entities";
import { registryDevices, deviceAcks } from "@/db/schema/registry";
import { iperfResults } from "@/db/schema/iperf";
import { aiAnalyses } from "@/db/schema/ai";
import { issues } from "@/db/schema/issues";
import { getSessionUser } from "@/lib/auth/current-user";

const DATA_PATH = "/settings/data";

export interface DataActionState {
  error?: string;
  ok?: boolean;
  message?: string;
}

type EntityKind = "district" | "school" | "sensor";

async function requireAdmin() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user.role === "superadmin" ? user : null;
}

async function audit(
  actor: string,
  action: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db.insert(auditLog).values({ actorType: "user", actor, action, detail });
  } catch {
    // best-effort
  }
}

function parseKind(v: unknown): EntityKind | null {
  return v === "district" || v === "school" || v === "sensor" ? v : null;
}

/** Look up an entity's current slug (the confirm phrase) by kind+id. */
async function getSlug(kind: EntityKind, id: number): Promise<string | null> {
  if (kind === "district") {
    const [r] = await db.select({ slug: districts.slug }).from(districts).where(eq(districts.id, id));
    return r?.slug ?? null;
  }
  if (kind === "school") {
    const [r] = await db.select({ slug: schools.slug }).from(schools).where(eq(schools.id, id));
    return r?.slug ?? null;
  }
  const [r] = await db.select({ slug: sensors.slug }).from(sensors).where(eq(sensors.id, id));
  return r?.slug ?? null;
}

export async function renameEntityAction(
  _prev: DataActionState,
  formData: FormData,
): Promise<DataActionState> {
  const user = await requireAdmin();
  if (!user) return { error: "Not authorized." };

  const kind = parseKind(formData.get("kind"));
  const id = Number(formData.get("id"));
  const newName = String(formData.get("name") ?? "").trim();
  if (!kind || !Number.isFinite(id)) return { error: "Invalid request." };
  if (!newName) return { error: "Name cannot be empty." };
  if (newName.length > 120) return { error: "Name is too long." };

  if (kind === "district") {
    await db.update(districts).set({ name: newName }).where(eq(districts.id, id));
  } else if (kind === "school") {
    await db.update(schools).set({ name: newName }).where(eq(schools.id, id));
  } else {
    await db.update(sensors).set({ name: newName }).where(eq(sensors.id, id));
  }

  await audit(user.email, "data_rename", { kind, id, newName });
  revalidatePath(DATA_PATH);
  return { ok: true, message: `Renamed to “${newName}”. Incoming data still maps by slug.` };
}

export async function deleteEntityAction(
  _prev: DataActionState,
  formData: FormData,
): Promise<DataActionState> {
  const user = await requireAdmin();
  if (!user) return { error: "Not authorized." };

  const kind = parseKind(formData.get("kind"));
  const id = Number(formData.get("id"));
  const confirm = String(formData.get("confirm") ?? "").trim();
  if (!kind || !Number.isFinite(id)) return { error: "Invalid request." };

  const slug = await getSlug(kind, id);
  if (!slug) return { error: "That item no longer exists." };
  if (confirm !== slug) {
    return { error: `Type the ${kind} slug “${slug}” exactly to confirm deletion.` };
  }

  // Deleting a district must also tear down its depot SFTP user + folder on Azure
  // — the DB cascade can't reach Azure, and the teardown needs the district_sftp
  // row that the cascade is about to remove, so do it FIRST. Best-effort: an Azure
  // hiccup must not block the DB delete. Mirrors deleteDistrictAction.
  if (kind === "district") {
    try {
      const { deleteDistrictSftp } = await import("@/lib/admin/sftp-provision");
      await deleteDistrictSftp(id, slug);
    } catch (e) {
      console.error(`[data-delete] sftp teardown ${slug} failed:`, e);
    }
  }

  await db.transaction(async (tx) => {
    if (kind === "district") {
      const schoolRows = await tx
        .select({ id: schools.id })
        .from(schools)
        .where(eq(schools.districtId, id));
      const schoolIds = schoolRows.map((s) => s.id);
      if (schoolIds.length > 0) {
        await tx
          .delete(topologySnapshots)
          .where(
            and(
              eq(topologySnapshots.scopeType, "school"),
              inArray(topologySnapshots.scopeId, schoolIds),
            ),
          );
      }
      await tx
        .delete(topologySnapshots)
        .where(
          and(eq(topologySnapshots.scopeType, "district"), eq(topologySnapshots.scopeId, id)),
        );
      await tx.delete(districts).where(eq(districts.id, id)); // cascades the rest
    } else if (kind === "school") {
      await tx
        .delete(topologySnapshots)
        .where(
          and(eq(topologySnapshots.scopeType, "school"), eq(topologySnapshots.scopeId, id)),
        );
      await tx.delete(schools).where(eq(schools.id, id)); // cascades sensors + scans
    } else {
      await tx.delete(sensors).where(eq(sensors.id, id)); // cascades scan_runs + time-series
    }
  });

  await audit(user.email, "data_delete", { kind, id, slug });
  revalidatePath(DATA_PATH);
  return { ok: true, message: `Deleted ${kind} “${slug}” and all of its data.` };
}

/**
 * The SCALPEL counterpart to resetSchoolDataAction: trim raw scan history for a
 * school over a date window. Deletes `scan_runs` (+ cascaded per-scan time-series)
 * for ALL the school's sensors within [from, to], but KEEPS the canonical layer —
 * discovered entities, topology, saved map, settings — and the ingest ledger. Use
 * it to drop a bad window or reclaim hot-table rows without disturbing inventory.
 */
export async function purgeSchoolScansAction(
  _prev: DataActionState,
  formData: FormData,
): Promise<DataActionState> {
  const user = await requireAdmin();
  if (!user) return { error: "Not authorized." };

  const schoolId = Number(formData.get("schoolId"));
  const fromRaw = String(formData.get("from") ?? "").trim();
  const toRaw = String(formData.get("to") ?? "").trim();
  if (!Number.isInteger(schoolId)) return { error: "Invalid school." };

  const from = fromRaw ? new Date(fromRaw) : null;
  // Treat the "to" date as inclusive of that whole day.
  const to = toRaw ? new Date(new Date(toRaw).getTime() + 24 * 60 * 60 * 1000 - 1) : null;
  if (from && Number.isNaN(from.getTime())) return { error: "Invalid start date." };
  if (to && Number.isNaN(to.getTime())) return { error: "Invalid end date." };
  if (!from && !to) {
    return { error: "Pick a start and/or end date — refusing to purge an unbounded range." };
  }
  if (from && to && from.getTime() > to.getTime()) {
    return { error: "Start date must be before end date." };
  }

  const [school] = await db
    .select({ id: schools.id, slug: schools.slug })
    .from(schools)
    .where(eq(schools.id, schoolId));
  if (!school) return { error: "That school no longer exists." };

  const sensorRows = await db
    .select({ id: sensors.id })
    .from(sensors)
    .where(eq(sensors.schoolId, schoolId));
  const sensorIds = sensorRows.map((s) => s.id);

  let deleted = 0;
  if (sensorIds.length > 0) {
    const clauses = [inArray(scanRuns.sensorId, sensorIds)];
    if (from) clauses.push(gte(scanRuns.startedAt, from));
    if (to) clauses.push(lte(scanRuns.startedAt, to));
    const del = await db
      .delete(scanRuns)
      .where(and(...clauses))
      .returning({ id: scanRuns.id });
    deleted = del.length;
  }

  await audit(user.email, "data_purge_school_scans", {
    schoolId,
    slug: school.slug,
    from: from?.toISOString() ?? null,
    to: to?.toISOString() ?? null,
    deleted,
  });
  revalidatePath(DATA_PATH);
  return {
    ok: true,
    message: `Purged ${deleted} scan${deleted === 1 ? "" : "s"} (and their captured data) from school “${school.slug}”. Inventory, map and settings were kept.`,
  };
}

/**
 * Reset a SCHOOL's data: wipe everything the dashboard knows about the school's
 * network — every scan + cascaded time-series, discovered devices, topology, the
 * saved map layout, daily rollups, throughput history, manually-entered/imported
 * devices, AI reports and the issues list — while KEEPING the sensor(s) enrolled
 * with their config and all settings. Collection continues and fresh data
 * rebuilds. For the office-bench-test → field-deploy workflow, or to clear an
 * accumulated mess and start over.
 *
 * Discovered devices/topology are school-scoped (deduped across the school's
 * sensors), so the unit of reset is the SCHOOL, not a single sensor.
 *
 * DURABILITY: the `ingested_bundles` ledger is deliberately NOT cleared. The
 * nightly SFTP sync skips bundles already in that ledger (sync-core.ts); if we
 * dropped those rows, any old bundles still on the depot would be re-pulled and
 * rebuild the very data we just purged. Keeping the ledger makes the reset stick
 * (and repeatable) — new bundles still ingest normally.
 */
export async function resetSchoolDataAction(
  _prev: DataActionState,
  formData: FormData,
): Promise<DataActionState> {
  const user = await requireAdmin();
  if (!user) return { error: "Not authorized." };

  const schoolId = Number(formData.get("schoolId"));
  const basePath = String(formData.get("basePath") ?? "");
  const confirm = String(formData.get("confirm") ?? "").trim();
  if (!Number.isInteger(schoolId)) return { error: "Invalid school." };

  const [school] = await db
    .select({ id: schools.id, slug: schools.slug, districtId: schools.districtId })
    .from(schools)
    .where(eq(schools.id, schoolId));
  if (!school) return { error: "That school no longer exists." };
  if (confirm !== school.slug) {
    return { error: `Type the school slug “${school.slug}” exactly to confirm the reset.` };
  }

  const sensorRows = await db
    .select({ id: sensors.id })
    .from(sensors)
    .where(eq(sensors.schoolId, schoolId));
  const sensorIds = sensorRows.map((s) => s.id);

  let deletedScans = 0;
  await db.transaction(async (tx) => {
    // MACs of this school's discovered hosts — used to clear just this school's
    // entries from the district-scoped "newly discovered" ack feed.
    const hostMacRows = await tx
      .select({ mac: entitiesHost.mac })
      .from(entitiesHost)
      .where(eq(entitiesHost.schoolId, schoolId));
    const macs = [
      ...new Set(hostMacRows.map((h) => h.mac).filter((m): m is string => !!m)),
    ];

    if (sensorIds.length > 0) {
      // Scan history + all cascaded per-scan time-series (devices/neighbors/dhcp/
      // stp/traffic/snmp/findings). ingested_bundles is KEPT (see fn doc).
      const del = await tx
        .delete(scanRuns)
        .where(inArray(scanRuns.sensorId, sensorIds))
        .returning({ id: scanRuns.id });
      deletedScans = del.length;
      await tx.delete(iperfResults).where(inArray(iperfResults.sensorId, sensorIds));
    }

    // Discovered / derived knowledge for the school.
    await tx.delete(entitiesSwitch).where(eq(entitiesSwitch.schoolId, schoolId));
    await tx.delete(entitiesHost).where(eq(entitiesHost.schoolId, schoolId));
    await tx
      .delete(topologySnapshots)
      .where(and(eq(topologySnapshots.scopeType, "school"), eq(topologySnapshots.scopeId, schoolId)));
    await tx.delete(topologyPositions).where(eq(topologyPositions.schoolId, schoolId));
    // schoolId is nullable (district-level rollups have null) — eq() matches only
    // the school-scoped rows, leaving district rollups intact.
    await tx.delete(healthRollupDaily).where(eq(healthRollupDaily.schoolId, schoolId));

    // Curated + AI layers for the school (full clean slate per the chosen scope).
    await tx.delete(registryDevices).where(eq(registryDevices.schoolId, schoolId));
    await tx
      .delete(aiAnalyses)
      .where(and(eq(aiAnalyses.scopeType, "school"), eq(aiAnalyses.scopeId, schoolId)));
    await tx
      .delete(issues)
      .where(and(eq(issues.scopeType, "school"), eq(issues.scopeId, schoolId)));
    if (macs.length > 0) {
      await tx
        .delete(deviceAcks)
        .where(and(eq(deviceAcks.districtId, school.districtId), inArray(deviceAcks.mac, macs)));
    }
  });

  await audit(user.email, "data_reset_school", {
    schoolId,
    slug: school.slug,
    sensorIds,
    deletedScans,
  });
  if (basePath) revalidatePath(basePath, "layout");
  revalidatePath(DATA_PATH);
  return {
    ok: true,
    message: `Reset school “${school.slug}” — purged ${deletedScans} scan${deletedScans === 1 ? "" : "s"} plus discovered devices, topology, saved map layout, manual devices, AI reports and issues. Sensor enrollment and all settings were kept, and the SFTP ledger is preserved so old bundles won't re-import.`,
  };
}
