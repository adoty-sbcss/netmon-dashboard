import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { shellSessions } from "@/db/schema/management";
import { hashToken } from "@/lib/sensor/auth";
import { getSession, isTerminal, expireIfPast } from "@/lib/broker/sessions";

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

  // First sensor connection promotes the session from pending -> active.
  if (role === "sensor" && s.status === "pending") {
    await db
      .update(shellSessions)
      .set({ status: "active" })
      .where(eq(shellSessions.id, sid));
  }

  return NextResponse.json({
    ok: true,
    sid,
    sensorId: s.sensorId,
    expiresAt: s.expiresAt.getTime(),
    recordKey: s.recordKey,
  });
}
