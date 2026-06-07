import "server-only";

import { db } from "@/db";
import { securityEvents } from "@/db/schema/app";

/**
 * recordSecurityEvent — the single write path into the consolidated
 * security_events table. Called at security-relevant points (failed logins,
 * authz denials, sensor auth failures, …). Best-effort by contract: it never
 * throws, so security logging can't break the request path it observes (same
 * guarantee as the audit() helpers).
 */

export type SecuritySeverity = "info" | "low" | "medium" | "high" | "critical";

export type SecurityCategory =
  | "auth" // login / session / credential events
  | "authz" // access-control denials
  | "sensor" // sensor enrollment / check-in auth
  | "admin" // privileged config changes
  | "perimeter" // edge / network signals (mostly source='azure')
  | "system"; // app-internal security state

export interface SecurityEventInput {
  category: SecurityCategory;
  action: string;
  severity?: SecuritySeverity;
  actorType?: string | null;
  actor?: string | null;
  sourceIp?: string | null;
  userAgent?: string | null;
  target?: string | null;
  districtId?: number | null;
  detail?: Record<string, unknown>;
  source?: "app" | "azure";
}

export async function recordSecurityEvent(evt: SecurityEventInput): Promise<void> {
  try {
    await db.insert(securityEvents).values({
      category: evt.category,
      action: evt.action,
      severity: evt.severity ?? "info",
      actorType: evt.actorType ?? null,
      actor: evt.actor ?? null,
      sourceIp: evt.sourceIp ?? null,
      userAgent: evt.userAgent ?? null,
      target: evt.target ?? null,
      districtId: evt.districtId ?? null,
      detail: evt.detail ?? {},
      source: evt.source ?? "app",
    });
  } catch {
    // Best-effort: a logging failure must never break the observed request.
  }
}
