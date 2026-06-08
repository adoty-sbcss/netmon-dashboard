import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { shellSessions } from "@/db/schema/management";
import { hashToken } from "@/lib/sensor/auth";
import { getSession, isTerminal, expireIfPast } from "@/lib/broker/sessions";
import { CONSOLE_TTL_MS, CONSOLE_ABS_MAX_MS } from "@/lib/admin/console-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Broker -> dashboard: verify an opaque one-time console token for a session.
 * Called once per WS connection (operator + sensor). Authenticated by the token
 * itself (matched against the stored sha256 hash); no other auth.
 *
 *   POST /api/broker/validate  { token, role: "operator"|"sensor", sid }
 *   -> { ok, sid, sensorId, expiresAt(ms), recordKey } | { ok: false }
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    token?: string;
    role?: string;
    sid?: string;
  };
  const { token, role, sid } = body;
  if (!token || (role !== "operator" && role !== "sensor") || !sid) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const s = await getSession(sid);
  if (!s) return NextResponse.json({ ok: false }, { status: 404 });
  if (isTerminal(s.status) || (await expireIfPast(s))) {
    return NextResponse.json({ ok: false }, { status: 410 });
  }

  const expected = role === "operator" ? s.operatorTokenHash : s.sensorTokenHash;
  if (hashToken(token) !== expected) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // First sensor connection promotes the session from pending -> active AND
  // (re)starts the time-box at PAIRING. The clock was provisionally set at click
  // (openConsoleSessionAction), but the sensor only dials in on its next ~10-min
  // check-in; without this reset that wait would silently eat the usable session.
  // Capped so a session can never run past createdAt + CONSOLE_ABS_MAX_MS.
  let expiresAtMs = s.expiresAt.getTime();
  if (role === "sensor" && s.status === "pending") {
    expiresAtMs = Math.min(
      s.createdAt.getTime() + CONSOLE_ABS_MAX_MS,
      Date.now() + CONSOLE_TTL_MS,
    );
    await db
      .update(shellSessions)
      .set({ status: "active", expiresAt: new Date(expiresAtMs) })
      .where(eq(shellSessions.id, sid));
  }

  return NextResponse.json({
    ok: true,
    sid,
    sensorId: s.sensorId,
    expiresAt: expiresAtMs,
    recordKey: s.recordKey,
  });
}
