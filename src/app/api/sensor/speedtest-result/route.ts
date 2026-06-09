import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import { speedtestResults } from "@/db/schema/iperf";
import { resolveSensorFromBearer } from "@/lib/sensor/auth";

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
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

  let startedAt: Date | null = null;
  if (typeof b.startedAt === "string") {
    const d = new Date(b.startedAt);
    if (!Number.isNaN(d.getTime())) startedAt = d;
  }

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
