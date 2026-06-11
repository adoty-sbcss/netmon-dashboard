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
import { sensors, users, districts } from "./app";

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
 * SFTP-2b: per-district scoped SFTP user on the bundle depot. Auto-minted on
 * district create via the dashboard's managed identity + the scoped custom role.
 * Each district's user is chroot'd to bundles/upload/<slug> so a leaked sensor
 * credential only exposes that one district's folder. Password stored ENCRYPTED
 * (decrypted only to render the deploy installer for that spot).
 */
export const districtSftp = pgTable("district_sftp", {
  id: serial("id").primaryKey(),
  districtId: integer("district_id")
    .notNull()
    .unique()
    .references(() => districts.id, { onDelete: "cascade" }),
  /** SFTP login: "<account>.<district-slug>". */
  username: text("username").notNull(),
  /** secret-box(password). */
  passwordEnc: text("password_enc").notNull(),
  /** Chroot home directory, e.g. "bundles/upload/springfield-usd". */
  homeDir: text("home_dir").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const shellSessionStatus = pgEnum("shell_session_status", [
  "pending", // session row created + open-console command queued; waiting for sensor to dial the broker
  "active", // both ends connected through the broker
  "closed", // ended normally (either side disconnected, or operator closed)
  "killed", // operator/admin pulled the kill-switch
  "expired", // hard time-box reached
]);

/**
 * Remote-console (browser SSH-like) session. The dashboard mints two opaque
 * one-time tokens (operator + sensor, stored ONLY as sha256 hashes) plus a
 * per-session recordKey the zero-secret broker uses to authenticate its
 * /api/broker/alive + /transcript callbacks. The full transcript is recorded
 * server-side here so the audit trail can't be tampered with from the browser.
 *
 * SECURITY: superadmin-only to open; restricted-command posture (only allow-
 * listed diag-* commands flow); hard time-boxed via expiresAt; kill-switch via
 * status='killed' (the broker polls /alive). Every open/kill emits a
 * recordSecurityEvent (category 'admin').
 */
export const shellSessions = pgTable(
  "shell_sessions",
  {
    /** sid — random hex, also the broker pairing key. */
    id: text("id").primaryKey(),
    sensorId: integer("sensor_id")
      .notNull()
      .references(() => sensors.id, { onDelete: "cascade" }),
    status: shellSessionStatus("status").notNull().default("pending"),
    /** sha256(plaintext); plaintext lives only in the browser / the sensor command args. */
    operatorTokenHash: text("operator_token_hash").notNull(),
    sensorTokenHash: text("sensor_token_hash").notNull(),
    /** Capability the broker presents on /alive + /transcript (session-scoped). */
    recordKey: text("record_key").notNull(),
    /** The open-console command queued for the sensor. */
    commandId: integer("command_id").references(() => commandQueue.id, {
      onDelete: "set null",
    }),
    openedBy: integer("opened_by").references(() => users.id, { onDelete: "set null" }),
    openedByEmail: text("opened_by_email"),
    /**
     * Super-admin approval gate (interim control until a deeper security review).
     * The session row is created but its `open-console` command is NOT queued
     * until a super-admin clicks the emailed approve link. approvalTokenHash is
     * the sha256 of the secret in that link (plaintext lives only in the email).
     */
    approvalTokenHash: text("approval_token_hash"),
    approvedBy: integer("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    /** Append-only recorded frames: [{t, dir, frame}]. */
    transcript: jsonb("transcript").notNull().default([]),
    eventCount: integer("event_count").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [index("idx_shell_sessions_sensor").on(t.sensorId, t.createdAt)],
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
