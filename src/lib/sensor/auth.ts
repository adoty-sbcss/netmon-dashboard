/**
 * Sensor enrollment-token auth for the outbound check-in endpoints. The sensor
 * sends `Authorization: Bearer <token>`; we look it up by sha256 hash (the
 * plaintext is never stored) and return the sensor id.
 */
import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { sensorEnrollments } from "@/db/schema/management";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Resolve a sensor id from a Bearer enrollment token, or null. Touches lastUsedAt. */
export async function resolveSensorFromBearer(
  authHeader: string | null,
): Promise<number | null> {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1].trim();
  if (!token) return null;

  const [row] = await db
    .select({ id: sensorEnrollments.id, sensorId: sensorEnrollments.sensorId })
    .from(sensorEnrollments)
    .where(
      and(eq(sensorEnrollments.tokenHash, hashToken(token)), eq(sensorEnrollments.revoked, false)),
    )
    .limit(1);
  if (!row) return null;

  await db
    .update(sensorEnrollments)
    .set({ lastUsedAt: new Date() })
    .where(eq(sensorEnrollments.id, row.id))
    .catch(() => {});
  return row.sensorId;
}
