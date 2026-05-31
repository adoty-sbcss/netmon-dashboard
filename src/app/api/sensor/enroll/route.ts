import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { auditLog } from "@/db/schema/app";
import { sensorEnrollments } from "@/db/schema/management";
import { verifyBootstrap } from "@/lib/sensor/enrollment";
import { hashToken } from "@/lib/sensor/auth";
import { getOrCreateSensorId } from "@/ingest/config-backup";
import { slugify } from "@/ingest/bundle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Auto-enroll a sensor with the shared bootstrap key. The box calls this once
 * (when it has no token yet); on success it gets a unique per-sensor token to
 * store and use for all future check-ins.
 *
 *   POST /api/sensor/enroll
 *   body: { bootstrapKey, district, school, device }
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    bootstrapKey?: string;
    district?: string;
    school?: string;
    device?: string;
  };

  if (!(await verifyBootstrap(String(body.bootstrapKey ?? "")))) {
    return NextResponse.json({ error: "enrollment refused" }, { status: 401 });
  }

  const district = slugify(String(body.district ?? ""));
  const school = slugify(String(body.school ?? ""));
  const device = slugify(String(body.device ?? ""));
  if (!district || !school || !device) {
    return NextResponse.json({ error: "missing identity" }, { status: 400 });
  }

  const sensorId = await getOrCreateSensorId(district, school, device);
  const token = `nms1_${randomBytes(24).toString("base64url")}`;

  await db.transaction(async (tx) => {
    await tx
      .update(sensorEnrollments)
      .set({ revoked: true })
      .where(eq(sensorEnrollments.sensorId, sensorId));
    await tx.insert(sensorEnrollments).values({ sensorId, tokenHash: hashToken(token) });
  });

  try {
    await db.insert(auditLog).values({
      actorType: "system",
      actor: `${district}/${school}/${device}`,
      action: "sensor_auto_enrolled",
      detail: { sensorId },
    });
  } catch {
    // best-effort
  }

  return NextResponse.json({ token });
}
