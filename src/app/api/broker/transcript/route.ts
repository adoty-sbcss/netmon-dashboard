import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { shellSessions } from "@/db/schema/management";
import { getSession, isTerminal } from "@/lib/broker/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_EVENTS = 5000;

/**
 * Broker -> dashboard transcript recorder. The broker flushes the FULL session
 * transcript (bounded, already per-frame truncated) periodically and on close,
 * so the audit trail is server-side and can't be tampered with from the
 * browser. Authenticated by the per-session recordKey header.
 *
 *   POST /api/broker/transcript  { sid, events: [...], closed: boolean }
 *   x-record-key: <recordKey>
 */
export async function POST(req: NextRequest) {
  const key = req.headers.get("x-record-key");
  const body = (await req.json().catch(() => ({}))) as {
    sid?: string;
    events?: unknown;
    closed?: boolean;
  };
  const { sid, events, closed } = body;
  if (!sid || !key || !Array.isArray(events)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const s = await getSession(sid);
  if (!s || s.recordKey !== key) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const capped = events.slice(0, MAX_EVENTS);
  // Don't override a kill/expire with a 'closed' from a late flush.
  const markClosed = closed && !isTerminal(s.status);

  await db
    .update(shellSessions)
    .set({
      transcript: capped,
      eventCount: capped.length,
      ...(markClosed ? { status: "closed" as const, closedAt: new Date() } : {}),
    })
    .where(eq(shellSessions.id, sid));

  return NextResponse.json({ ok: true });
}
