import { NextResponse, type NextRequest } from "next/server";
import { and, eq, inArray, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { sensors } from "@/db/schema/app";
import { desiredConfig, commandQueue } from "@/db/schema/management";
import { resolveSensorFromBearer } from "@/lib/sensor/auth";
import { clientIp } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sensor check-in (outbound poll). Authenticated by the enrollment token.
 * The sensor reports its agent + applied-config version; we return the desired
 * config and hand out any dispatchable commands (marking them 'sent').
 *
 *   POST /api/sensor/checkin   Authorization: Bearer <token>
 *   body: { agentVersion?: string, configVersion?: number }
 */
export async function POST(req: NextRequest) {
  const sensorId = await resolveSensorFromBearer(req.headers.get("authorization"));
  if (!sensorId) {
    await recordSecurityEvent({
      category: "sensor",
      action: "sensor_auth_failed",
      severity: "low",
      actorType: "anon",
      sourceIp: clientIp(req.headers),
      userAgent: req.headers.get("user-agent"),
      target: "/api/sensor/checkin",
      detail: { hasAuthHeader: Boolean(req.headers.get("authorization")) },
    });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    agentVersion?: string;
    configVersion?: number;
    /** Release-channel rollout telemetry. */
    commitSha?: string;
    updateChannel?: string;
    /** Outcome of the box's last host-side auto-update (auto-update.sh). */
    lastUpdate?: {
      status?: string;
      reason?: string;
      from?: string;
      to?: string;
      channel?: string;
      at?: string;
    } | null;
    localIp?: string;
    interface?: string;
    interfaceCidr?: string;
    // Actual config the box is running (ground truth). Password is never sent.
    currentConfig?: {
      snmp_enabled?: boolean;
      snmp_communities?: string;
      sftp_enabled?: boolean;
      sftp_host?: string;
      sftp_port?: number;
      sftp_user?: string;
    };
    // The box's own self-health snapshot { cpu, mem, disk, os, uptimeSec, tempC }.
    hostMetrics?: Record<string, unknown>;
  };

  const cc = body.currentConfig;
  await db
    .update(sensors)
    .set({
      lastCheckinAt: sql`now()`,
      ...(typeof body.agentVersion === "string" ? { agentVersion: body.agentVersion } : {}),
      ...(Number.isInteger(body.configVersion)
        ? { reportedConfigVersion: body.configVersion }
        : {}),
      ...(typeof body.localIp === "string" ? { localIp: body.localIp } : {}),
      ...(typeof body.interface === "string" ? { iface: body.interface } : {}),
      ...(typeof body.interfaceCidr === "string" ? { ifaceCidr: body.interfaceCidr } : {}),
      ...(typeof body.commitSha === "string" ? { reportedSha: body.commitSha } : {}),
      ...(typeof body.updateChannel === "string" ? { reportedChannel: body.updateChannel } : {}),
      ...(body.lastUpdate && typeof body.lastUpdate === "object"
        ? {
            lastUpdateStatus:
              typeof body.lastUpdate.status === "string" ? body.lastUpdate.status : null,
            lastUpdateReason:
              typeof body.lastUpdate.reason === "string" ? body.lastUpdate.reason : null,
            lastUpdateFrom:
              typeof body.lastUpdate.from === "string" ? body.lastUpdate.from : null,
            lastUpdateTo: typeof body.lastUpdate.to === "string" ? body.lastUpdate.to : null,
            lastUpdateAt: typeof body.lastUpdate.at === "string" ? body.lastUpdate.at : null,
          }
        : {}),
      ...(body.hostMetrics && typeof body.hostMetrics === "object"
        ? { reportedHostMetrics: body.hostMetrics, reportedMetricsAt: sql`now()` }
        : {}),
      ...(cc
        ? {
            reportedSnmpEnabled:
              typeof cc.snmp_enabled === "boolean" ? cc.snmp_enabled : null,
            reportedSnmpCommunities:
              typeof cc.snmp_communities === "string" ? cc.snmp_communities : null,
            reportedSftpEnabled:
              typeof cc.sftp_enabled === "boolean" ? cc.sftp_enabled : null,
            reportedSftpHost: typeof cc.sftp_host === "string" ? cc.sftp_host : null,
            reportedSftpPort: Number.isInteger(cc.sftp_port) ? cc.sftp_port : null,
            reportedSftpUser: typeof cc.sftp_user === "string" ? cc.sftp_user : null,
            reportedConfigAt: sql`now()`,
          }
        : {}),
    })
    .where(eq(sensors.id, sensorId));

  const [cfg] = await db
    .select({ v: desiredConfig.configVersion, config: desiredConfig.config })
    .from(desiredConfig)
    .where(eq(desiredConfig.sensorId, sensorId))
    .limit(1);

  // Dispatchable = approved, or pending & not requiring approval.
  const dispatchable = await db
    .select({ id: commandQueue.id, command: commandQueue.command, args: commandQueue.args })
    .from(commandQueue)
    .where(
      and(
        eq(commandQueue.sensorId, sensorId),
        or(
          eq(commandQueue.status, "approved"),
          and(eq(commandQueue.status, "pending"), eq(commandQueue.requiresApproval, false)),
        ),
      ),
    );

  if (dispatchable.length > 0) {
    await db
      .update(commandQueue)
      .set({ status: "sent", sentAt: sql`now()` })
      .where(inArray(commandQueue.id, dispatchable.map((c) => c.id)));
  }

  return NextResponse.json({
    config: cfg ? { version: cfg.v, data: cfg.config } : null,
    commands: dispatchable,
  });
}
