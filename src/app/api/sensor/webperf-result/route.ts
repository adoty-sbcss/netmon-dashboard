import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import { webperfResults } from "@/db/schema/iperf";
import { resolveSensorFromBearer } from "@/lib/sensor/auth";
import { coerceNum as num, coerceInt as intOf, coerceStr as str, parseStartedAt } from "@/lib/sensor/payload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sensor reports one website-performance probe (PERF-5). Bearer-authenticated by the
 * enrollment token, same as check-in. One POST per URL per cycle.
 *
 *   POST /api/sensor/webperf-result   Authorization: Bearer <token>
 */
export async function POST(req: NextRequest) {
  const sensorId = await resolveSensorFromBearer(req.headers.get("authorization"));
  if (!sensorId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const startedAt = parseStartedAt(b.startedAt);

  await db.insert(webperfResults).values({
    sensorId,
    trigger: str(b.trigger) === "scheduled" ? "scheduled" : "manual",
    url: str(b.url),
    dnsMs: num(b.dnsMs),
    tcpMs: num(b.tcpMs),
    tlsMs: num(b.tlsMs),
    ttfbMs: num(b.ttfbMs),
    totalMs: num(b.totalMs),
    httpStatus: intOf(b.httpStatus),
    sizeBytes: intOf(b.sizeBytes),
    speedMbps: num(b.speedMbps),
    ok: b.ok !== false,
    error: str(b.error),
    startedAt,
  });

  return NextResponse.json({ ok: true });
}
