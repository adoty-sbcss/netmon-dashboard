import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import { speedtestResults } from "@/db/schema/iperf";
import { resolveSensorFromBearer } from "@/lib/sensor/auth";
import { coerceNum as num, coerceStr as str, parseStartedAt } from "@/lib/sensor/payload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sensor reports a public internet speed test (Ookla or Cloudflare), on-demand
 * or scheduled (PERF-2). Bearer-authenticated by the enrollment token, same as
 * check-in.
 *
 *   POST /api/sensor/speedtest-result   Authorization: Bearer <token>
 */
export async function POST(req: NextRequest) {
  const sensorId = await resolveSensorFromBearer(req.headers.get("authorization"));
  if (!sensorId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const startedAt = parseStartedAt(b.startedAt);

  const provider = str(b.provider);

  await db.insert(speedtestResults).values({
    sensorId,
    trigger: str(b.trigger) === "scheduled" ? "scheduled" : "manual",
    provider: provider === "cloudflare" ? "cloudflare" : provider === "ookla" ? "ookla" : provider,
    downloadMbps: num(b.downloadMbps),
    uploadMbps: num(b.uploadMbps),
    latencyMs: num(b.latencyMs),
    jitterMs: num(b.jitterMs),
    lossPct: num(b.lossPct),
    server: str(b.server),
    isp: str(b.isp),
    resultUrl: str(b.resultUrl),
    externalIp: str(b.externalIp),
    ok: b.ok !== false,
    error: str(b.error),
    raw: (b.raw ?? null) as object | null,
    startedAt,
  });

  return NextResponse.json({ ok: true });
}
