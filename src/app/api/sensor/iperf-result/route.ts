import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import { iperfResults } from "@/db/schema/iperf";
import { resolveSensorFromBearer } from "@/lib/sensor/auth";
import { coerceNum as num, coerceInt as intOf, coerceStr as str, parseStartedAt } from "@/lib/sensor/payload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sensor reports an iperf3 run (on-demand or scheduled). Bearer-authenticated by
 * the enrollment token, same as check-in.
 *
 *   POST /api/sensor/iperf-result   Authorization: Bearer <token>
 */
export async function POST(req: NextRequest) {
  const sensorId = await resolveSensorFromBearer(req.headers.get("authorization"));
  if (!sensorId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const startedAt = parseStartedAt(b.startedAt);

  await db.insert(iperfResults).values({
    sensorId,
    trigger: str(b.trigger) === "scheduled" ? "scheduled" : "manual",
    serverHost: str(b.serverHost),
    serverPort: intOf(b.serverPort),
    protocol: str(b.protocol) === "udp" ? "udp" : "tcp",
    direction: str(b.direction),
    durationSec: intOf(b.durationSec),
    throughputMbps: num(b.throughputMbps),
    retransmits: intOf(b.retransmits),
    jitterMs: num(b.jitterMs),
    lossPct: num(b.lossPct),
    ok: b.ok !== false,
    error: str(b.error),
    raw: (b.raw ?? null) as object | null,
    startedAt,
  });

  return NextResponse.json({ ok: true });
}
