import { NextResponse, type NextRequest } from "next/server";

import { getSession, isAlive } from "@/lib/broker/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Broker -> dashboard kill-switch poll. The broker calls this every ~10s and
 * drops the tunnel when {alive:false} (operator hit kill, or the time-box
 * passed). Authenticated by the per-session recordKey header.
 *
 *   GET /api/broker/alive?sid=<sid>   x-record-key: <recordKey>
 *   -> { alive: boolean }
 */
export async function GET(req: NextRequest) {
  const sid = req.nextUrl.searchParams.get("sid");
  const key = req.headers.get("x-record-key");
  if (!sid || !key) return NextResponse.json({ alive: false }, { status: 400 });

  const s = await getSession(sid);
  if (!s || s.recordKey !== key) {
    return NextResponse.json({ alive: false }, { status: 401 });
  }
  return NextResponse.json({ alive: isAlive(s) });
}
