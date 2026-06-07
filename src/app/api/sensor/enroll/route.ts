import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { auditLog } from "@/db/schema/app";
import { sensorEnrollments } from "@/db/schema/management";
import { verifyBootstrap } from "@/lib/sensor/enrollment";
import { hashToken } from "@/lib/sensor/auth";
import { rateLimit, clientIp } from "@/lib/security/rate-limit";
import { getOrCreateSensorId } from "@/ingest/config-backup";
import { slugify } from "@/ingest/bundle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A box enrolls once, ever — so a tight per-IP cap throttles bootstrap-key
// brute-forcing without affecting legitimate fleet rollout (each box is behind
// its own site egress IP).
const ENROLL_MAX_ATTEMPTS = 5;
const ENROLL_WINDOW_MS = 10 * 60_000;

/** Best-effort audit that never blocks the response. */
async function auditEnroll(actor: string, action: string, detail: Record<string, unknown>) {
  try {
    await db.insert(auditLog).values({ actorType: "system", actor, action, detail });
  } catch {
    // best-effort
  }
}

/**
 * Auto-enroll a sensor with the shared bootstrap key. The box calls this once
 * (when it has no token yet); on success it gets a unique per-sensor token to
 * store and use for all future check-ins.
 *
 *   POST /api/sensor/enroll
 *   body: { bootstrapKey, district, school, device }
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  const throttle = rateLimit(`enroll:ip:${ip}`, ENROLL_MAX_ATTEMPTS, ENROLL_WINDOW_MS);
  if (!throttle.ok) {
    await auditEnroll(ip, "sensor_enroll_rate_limited", { ip, retryAfterSec: throttle.retryAfterSec });
    return NextResponse.json(
      { error: "rate limited" },
      { status: 429, headers: { "Retry-After": String(throttle.retryAfterSec) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    bootstrapKey?: string;
    district?: string;
    school?: string;
    device?: string;
  };

  if (!(await verifyBootstrap(String(body.bootstrapKey ?? "")))) {
    await auditEnroll(ip, "sensor_enroll_refused", { ip, reason: "bad_bootstrap_key" });
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

  await auditEnroll(`${district}/${school}/${device}`, "sensor_auto_enrolled", { sensorId, ip });

  return NextResponse.json({ token });
}
