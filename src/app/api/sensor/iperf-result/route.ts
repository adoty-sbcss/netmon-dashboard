import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import { iperfResults } from "@/db/schema/iperf";
import { resolveSensorFromBearer } from "@/lib/sensor/auth";

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
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const intOf = (v: unknown): number | null =>
    typeof v === "number" && Number.isInteger(v) ? v : null;
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

  let startedAt: Date | null = null;
  if (typeof b.startedAt === "string") {
    const d = new Date(b.startedAt);
    if (!Number.isNaN(d.getTime())) startedAt = d;
  }

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
