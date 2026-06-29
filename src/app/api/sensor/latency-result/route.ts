import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import { latencyResults } from "@/db/schema/iperf";
import { resolveSensorFromBearer } from "@/lib/sensor/auth";
import { coerceNum as num, coerceStr as str, parseStartedAt } from "@/lib/sensor/payload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sensor reports a latency/jitter/loss probe (PERF-4), one POST per target.
 * Bearer-authenticated by the enrollment token, same as check-in.
 *
 *   POST /api/sensor/latency-result   Authorization: Bearer <token>
 */
export async function POST(req: NextRequest) {
  const sensorId = await resolveSensorFromBearer(req.headers.get("authorization"));
  if (!sensorId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const startedAt = parseStartedAt(b.startedAt);

  const label = str(b.label);

  await db.insert(latencyResults).values({
    sensorId,
    trigger: str(b.trigger) === "manual" ? "manual" : "scheduled",
    label: label === "gateway" || label === "dns" ? label : label === "internet" ? "internet" : label,
    target: str(b.target),
    latencyMs: num(b.latencyMs),
    jitterMs: num(b.jitterMs),
    lossPct: num(b.lossPct),
    ok: b.ok !== false,
    error: str(b.error),
    startedAt,
  });

  return NextResponse.json({ ok: true });
}
