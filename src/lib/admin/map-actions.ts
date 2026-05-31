"use server";

/**
 * Persist manual network-map node positions. Superadmin-gated. Called directly
 * (not via a form) from the map's Save button with the current node layout.
 */
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { topologyPositions } from "@/db/schema/entities";
import { auditLog } from "@/db/schema/app";
import { getSessionUser } from "@/lib/auth/current-user";

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
