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
import { topologySnapshots } from "@/db/schema/entities";
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

export async function purgeScansAction(
  _prev: DataActionState,
  formData: FormData,
): Promise<DataActionState> {
  const user = await requireAdmin();
  if (!user) return { error: "Not authorized." };

  const sensorId = Number(formData.get("sensorId"));
  const fromRaw = String(formData.get("from") ?? "").trim();
  const toRaw = String(formData.get("to") ?? "").trim();
  if (!Number.isFinite(sensorId)) return { error: "Invalid sensor." };

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

  const slug = await getSlug("sensor", sensorId);
  if (!slug) return { error: "That sensor no longer exists." };

  const clauses = [eq(scanRuns.sensorId, sensorId)];
  if (from) clauses.push(gte(scanRuns.startedAt, from));
  if (to) clauses.push(lte(scanRuns.startedAt, to));

  const deleted = await db
    .delete(scanRuns)
    .where(and(...clauses))
    .returning({ id: scanRuns.id });

  await audit(user.email, "data_purge_scans", {
    sensorId,
    slug,
    from: from?.toISOString() ?? null,
    to: to?.toISOString() ?? null,
    deleted: deleted.length,
  });
  revalidatePath(DATA_PATH);
  return {
    ok: true,
    message: `Purged ${deleted.length} scan${deleted.length === 1 ? "" : "s"} (and their captured data) from “${slug}”.`,
  };
}
