import { NextResponse, type NextRequest } from "next/server";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { sensors } from "@/db/schema/app";
import { commandQueue, commandResults } from "@/db/schema/management";
import { resolveSensorFromBearer } from "@/lib/sensor/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A sensor reports the outcome of a queued command (outbound).
 *
 *   POST /api/sensor/result   Authorization: Bearer <token>
 *   body: { commandId: number, status: "done"|"failed", result?: object,
 *           configVersion?: number }
 */
export async function POST(req: NextRequest) {
  const sensorId = await resolveSensorFromBearer(req.headers.get("authorization"));
  if (!sensorId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    commandId?: number;
    status?: string;
    result?: unknown;
    configVersion?: number;
  };
  const status = body.status === "failed" ? "failed" : "done";

  if (Number.isInteger(body.configVersion)) {
    await db
      .update(sensors)
      .set({ reportedConfigVersion: body.configVersion })
      .where(eq(sensors.id, sensorId));
  }

  if (Number.isInteger(body.commandId)) {
    // Only accept results for this sensor's own commands.
    const [cmd] = await db
      .select({ id: commandQueue.id })
      .from(commandQueue)
      .where(and(eq(commandQueue.id, body.commandId!), eq(commandQueue.sensorId, sensorId)))
      .limit(1);
    if (cmd) {
      await db.insert(commandResults).values({
        commandId: cmd.id,
        status,
        result: (body.result ?? {}) as Record<string, unknown>,
      });
      await db
        .update(commandQueue)
        .set({ status })
        .where(eq(commandQueue.id, cmd.id));
    }
  }

  return NextResponse.json({ ok: true });
}
