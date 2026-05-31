/**
 * Sensor management plane (Section 8 of docs/DESIGN.md).
 *
 * Trust direction: the sensor ALWAYS initiates outbound HTTPS and polls for
 * work; the console NEVER connects inbound. This is the desired-state +
 * command-queue model. The seam exists now so the dashboard MVP isn't blocked;
 * the collector-side outbound agent loop is a later milestone.
 *
 * SECURITY: this is a control plane. Every command is audit-logged (auditLog),
 * destructive ones are approval-gated, and config pushes must be reversible
 * (NetMon's existing rollback/watchdog handles auto-rollback of bad pushes).
 */
import {
  pgTable,
  pgEnum,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sensors, users } from "./app";

export const commandStatus = pgEnum("command_status", [
  "pending", // queued, not yet approved (if approval required)
  "approved", // cleared to be handed out on next check-in
  "sent", // delivered to the sensor at check-in
  "acked", // sensor acknowledged receipt
  "done", // sensor reported successful completion
  "failed", // sensor reported failure
  "rejected", // an admin declined the pending command
]);

/**
 * Desired configuration for a sensor (one row per sensor). The sensor reconciles
 * toward this on each check-in; `sensors.reportedConfigVersion` reflects what it
 * has actually applied. Bump `configVersion` on every change.
 */
export const desiredConfig = pgTable("desired_config", {
  id: serial("id").primaryKey(),
  sensorId: integer("sensor_id")
    .notNull()
    .unique()
    .references(() => sensors.id, { onDelete: "cascade" }),
  configVersion: integer("config_version").notNull().default(1),
  config: jsonb("config").notNull().default({}),
  updatedBy: integer("updated_by").references(() => users.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** Work queued for a sensor to pick up on its next outbound check-in. */
export const commandQueue = pgTable(
  "command_queue",
  {
    id: serial("id").primaryKey(),
    sensorId: integer("sensor_id")
      .notNull()
      .references(() => sensors.id, { onDelete: "cascade" }),
    /** e.g. 'collect-logs' | 'run-scan' | 'restart' | 'update' | 'apply-config' */
    command: text("command").notNull(),
    args: jsonb("args").notNull().default({}),
    status: commandStatus("status").notNull().default("pending"),
    requiresApproval: boolean("requires_approval").notNull().default(false),
    createdBy: integer("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedBy: integer("approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    // Fast lookup of dispatchable work for a sensor at check-in time.
    index("idx_cmd_sensor_status").on(t.sensorId, t.status),
  ],
);

/** Result a sensor reports back (outbound) for a queued command. */
export const commandResults = pgTable(
  "command_results",
  {
    id: serial("id").primaryKey(),
    commandId: integer("command_id")
      .notNull()
      .references(() => commandQueue.id, { onDelete: "cascade" }),
    /** Mirrors the command's terminal status: 'done' | 'failed'. */
    status: text("status").notNull(),
    result: jsonb("result").notNull().default({}),
    reportedAt: timestamp("reported_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("idx_cmd_results_command").on(t.commandId)],
);

/**
 * Per-sensor config backups, pulled from the SFTP `_config/<d>/<s>/<dev>/` drop
 * the collector already uploads daily (netmon.env + snmp.yaml + manifest). Stored
 * on the dashboard so an admin can review/download/restore. The ZIP is small (a
 * few KB) so it's kept base64 inline rather than in Blob storage.
 *
 * SECURITY: netmon.env contains the sensor's SFTP credentials + SNMP strings, so
 * download is superadmin-only.
 */
export const configBackups = pgTable(
  "config_backups",
  {
    id: serial("id").primaryKey(),
    sensorId: integer("sensor_id")
      .notNull()
      .references(() => sensors.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    /** When the backup was taken (manifest backed_up_at, else the filename date). */
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    sizeBytes: integer("size_bytes"),
    /** base64 of the backup ZIP. */
    contentB64: text("content_b64").notNull(),
    manifest: jsonb("manifest").notNull().default({}),
    importedAt: timestamp("imported_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("uq_config_backup_sensor_file").on(t.sensorId, t.filename)],
);

/**
 * Per-sensor enrollment secret for authenticating outbound check-ins. Store a
 * HASH of the token, never the token itself (issued once at enrollment).
 */
export const sensorEnrollments = pgTable(
  "sensor_enrollments",
  {
    id: serial("id").primaryKey(),
    sensorId: integer("sensor_id")
      .notNull()
      .references(() => sensors.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    revoked: boolean("revoked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("uq_enroll_token_hash").on(t.tokenHash)],
);
