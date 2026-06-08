import { NextResponse, type NextRequest } from "next/server";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { commandQueue } from "@/db/schema/management";
import { resolveSensorFromBearer } from "@/lib/sensor/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lightweight interactive-command poll — faster-pickup for the live console
 * (CON-4 follow-up). The sensor hits this every ~30s, far cheaper than the full
 * ~10-min check-in, purely so a queued `open-console` command is picked up in
 * seconds and a live session pairs almost immediately instead of waiting for the
 * next check-in. Returns ONLY open-console commands — no config, no health, no
 * other command types. Authenticated by the enrollment token, same as check-in.
 *
 *   POST /api/sensor/console-poll   Authorization: Bearer <token>
 *   -> { commands: [{ id, command, args }] }
 */
export async function POST(req: NextRequest) {
  const sensorId = await resolveSensorFromBearer(req.headers.get("authorization"));
  if (!sensorId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Atomic claim: only the request whose UPDATE actually flips the row wins it,
  // so a poll that overlaps the full check-in can't double-dispatch the command.
  // open-console is queued as 'approved' (opening the session IS the auth).
  const claimed = await db
    .update(commandQueue)
    .set({ status: "sent", sentAt: sql`now()` })
    .where(
      and(
        eq(commandQueue.sensorId, sensorId),
        eq(commandQueue.command, "open-console"),
        eq(commandQueue.status, "approved"),
      ),
    )
    .returning({
      id: commandQueue.id,
      command: commandQueue.command,
      args: commandQueue.args,
    });

  return NextResponse.json({ commands: claimed });
}
