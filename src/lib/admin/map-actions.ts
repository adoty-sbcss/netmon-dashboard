"use server";

/**
 * Persist manual network-map node positions. Superadmin-gated. Called directly
 * (not via a form) from the map's Save button with the current node layout.
 */
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { topologyPositions, entitiesSwitch, entitiesHost } from "@/db/schema/entities";
import { auditLog, schools } from "@/db/schema/app";
import { getSessionUser } from "@/lib/auth/current-user";
import { getUserScope, scopeAllowsDistrict } from "@/lib/auth/scope";
import { recordSecurityEvent } from "@/lib/security/events";

export interface SavePositionsResult {
  ok: boolean;
  error?: string;
  saved?: number;
}

interface NodePos {
  nodeId: string;
  x: number;
  y: number;
}

export async function saveMapPositions(
  schoolId: number,
  kind: string,
  basePath: string,
  positions: NodePos[],
): Promise<SavePositionsResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (user.role !== "superadmin") return { ok: false, error: "Not authorized." };
  if (kind !== "physical" && kind !== "logical") return { ok: false, error: "Bad map kind." };
  if (!Array.isArray(positions) || positions.length === 0)
    return { ok: false, error: "Nothing to save." };
  if (positions.length > 5000) return { ok: false, error: "Too many nodes." };

  const clean = positions.filter(
    (p) =>
      typeof p.nodeId === "string" &&
      p.nodeId.length > 0 &&
      Number.isFinite(p.x) &&
      Number.isFinite(p.y),
  );

  await db.transaction(async (tx) => {
    for (const p of clean) {
      await tx
        .insert(topologyPositions)
        .values({ schoolId, kind, nodeId: p.nodeId, x: p.x, y: p.y })
        .onConflictDoUpdate({
          target: [topologyPositions.schoolId, topologyPositions.kind, topologyPositions.nodeId],
          set: { x: p.x, y: p.y, updatedAt: new Date() },
        });
    }
  });

  try {
    await db.insert(auditLog).values({
      actorType: "user",
      actor: user.email,
      action: "map_positions_saved",
      detail: { schoolId, kind, nodes: clean.length },
    });
  } catch {
    // best-effort
  }

  if (basePath) revalidatePath(basePath);
  return { ok: true, saved: clean.length };
}

export interface MapHiddenResult {
  ok: boolean;
  error?: string;
}

/**
 * Hide / unhide a device from the network map. A map-only toggle: unlike a purge
 * (excludedAt) it keeps the device in the inventory and the SNMP poll set — it only
 * removes it from the map graph and the AI map analysis. Shared state across
 * everyone viewing the school; the caller must be entitled to the school's
 * district (the proxy read-only gate already blocks viewers from mutating).
 */
export async function setDeviceMapHidden(
  schoolId: number,
  entityKind: "switch" | "host",
  entityId: number,
  hidden: boolean,
  basePath: string,
): Promise<MapHiddenResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (entityKind !== "switch" && entityKind !== "host") return { ok: false, error: "Bad device kind." };
  if (!Number.isInteger(entityId) || entityId <= 0) return { ok: false, error: "Bad device id." };

  // Authorize against the school's district: schoolId/entityId arrive straight from
  // the client, so without this gate any signed-in (non-viewer) user could toggle
  // map visibility on another district's devices — a cross-district IDOR.
  const [school] = await db
    .select({ districtId: schools.districtId })
    .from(schools)
    .where(eq(schools.id, schoolId))
    .limit(1);
  if (!school || school.districtId == null) return { ok: false, error: "Unknown school." };
  const scope = await getUserScope(user);
  if (!scopeAllowsDistrict(scope, school.districtId)) {
    return { ok: false, error: "Not authorized." };
  }

  const set = {
    mapHiddenAt: hidden ? new Date() : null,
    mapHiddenBy: hidden ? user.id : null,
  };
  if (entityKind === "switch") {
    await db
      .update(entitiesSwitch)
      .set(set)
      .where(and(eq(entitiesSwitch.id, entityId), eq(entitiesSwitch.schoolId, schoolId)));
  } else {
    await db
      .update(entitiesHost)
      .set(set)
      .where(and(eq(entitiesHost.id, entityId), eq(entitiesHost.schoolId, schoolId)));
  }

  try {
    await db.insert(auditLog).values({
      actorType: "user",
      actor: user.email,
      action: hidden ? "map_device_hidden" : "map_device_unhidden",
      detail: { schoolId, entityKind, entityId },
    });
  } catch {
    // best-effort
  }
  // Mirror into the consolidated security feed (privileged map change).
  await recordSecurityEvent({
    category: "admin",
    action: hidden ? "map_device_hidden" : "map_device_unhidden",
    severity: "info",
    actorType: "user",
    actor: user.email,
    target: `${entityKind}:${entityId}`,
    detail: { schoolId },
  });

  if (basePath) revalidatePath(basePath);
  return { ok: true };
}
