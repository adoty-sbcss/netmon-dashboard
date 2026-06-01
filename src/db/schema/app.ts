/**
 * App-owned tables: tenancy hierarchy, authentication/authorization, and
 * ingestion bookkeeping. These are NOT derived from NetMon bundles — they are
 * the dashboard's own state.
 *
 * Tenancy hierarchy mirrors NetMon's SFTP layout:
 *   district -> school -> sensor (the NetMon box at an IDF/switch).
 */
import {
  pgTable,
  pgEnum,
  serial,
  text,
  integer,
  boolean,
  bigint,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// --- enums -----------------------------------------------------------------

/** Top-level role. Authority is refined by `grants`; superadmin = global scope. */
export const userRole = pgEnum("user_role", ["superadmin", "user"]);

/** Scope a grant applies to. `global` (superadmin) ignores scopeId. */
export const scopeType = pgEnum("scope_type", [
  "global",
  "district",
  "school",
  "sensor",
]);

/** Lifecycle of a pulled bundle as it moves through the parse stage. */
export const parseStatus = pgEnum("parse_status", [
  "pending",
  "parsed",
  "failed",
]);

// --- tenancy ---------------------------------------------------------------

export const districts = pgTable("districts", {
  id: serial("id").primaryKey(),
  /** Matches NetMon's district_slug; the SFTP/bundle path key. */
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const schools = pgTable(
  "schools",
  {
    id: serial("id").primaryKey(),
    districtId: integer("district_id")
      .notNull()
      .references(() => districts.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [uniqueIndex("uq_schools_district_slug").on(t.districtId, t.slug)],
);

/**
 * A NetMon sensor box (the `device` level — one per IDF/switch). Doubles as the
 * navigation leaf AND the management-plane target. Management-specific desired
 * config and command queue live in schema/management.ts and reference this.
 */
export const sensors = pgTable(
  "sensors",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    /** Matches NetMon's device_slug. */
    slug: text("slug").notNull(),
    name: text("name"),
    // --- management-plane check-in state (sensor phones home; see management.ts)
    /** Last time the sensor checked in (null until first contact). */
    lastCheckinAt: timestamp("last_checkin_at", { withTimezone: true }),
    /** Config version the sensor reports as currently applied. */
    reportedConfigVersion: integer("reported_config_version"),
    /** Collector/agent version string the sensor reported. */
    agentVersion: text("agent_version"),
    /** The box's own LAN IP / interface / CIDR, reported at check-in. */
    localIp: text("local_ip"),
    iface: text("iface"),
    ifaceCidr: text("iface_cidr"),
    // --- actual config the box reports at check-in (ground truth; password NEVER
    //     reported). Lets the dashboard show real current config, not just what
    //     was pushed via desired_config.
    reportedSnmpEnabled: boolean("reported_snmp_enabled"),
    reportedSnmpCommunities: text("reported_snmp_communities"),
    reportedSftpEnabled: boolean("reported_sftp_enabled"),
    reportedSftpHost: text("reported_sftp_host"),
    reportedSftpPort: integer("reported_sftp_port"),
    reportedSftpUser: text("reported_sftp_user"),
    reportedConfigAt: timestamp("reported_config_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [uniqueIndex("uq_sensors_school_slug").on(t.schoolId, t.slug)],
);

// --- authn / authz ---------------------------------------------------------

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  /** IdP-verified email (lowercased). The join key from OIDC login. */
  email: text("email").notNull().unique(),
  displayName: text("display_name"),
  role: userRole("role").notNull().default("user"),
  /**
   * Break-glass local admin: non-federated, password + email-code MFA.
   * Bootstrap + emergency access only. passwordHash is set ONLY for these.
   */
  isBreakGlass: boolean("is_break_glass").notNull().default(false),
  passwordHash: text("password_hash"),
  /** Forces a password change on next login (set for seeded/default passwords). */
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  disabled: boolean("disabled").notNull().default(false),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * What a user may see. Authorization rule: trust the IdP-verified email, load
 * grants, filter every query. NEVER derive authority from email domain.
 * scopeId is null when scopeType = 'global'.
 */
export const grants = pgTable(
  "grants",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scopeType: scopeType("scope_type").notNull(),
    scopeId: integer("scope_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("uq_grants_user_scope").on(t.userId, t.scopeType, t.scopeId),
    index("idx_grants_user").on(t.userId),
  ],
);

/** Addresses that receive the break-glass login MFA code. Keep this list tight. */
export const breakGlassMfaEmails = pgTable("break_glass_mfa_emails", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** Append-only audit trail. Especially important for management-plane actions. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    /** 'user' | 'breakglass' | 'system' */
    actorType: text("actor_type").notNull(),
    /** Email or system component name. */
    actor: text("actor"),
    action: text("action").notNull(),
    target: text("target"),
    detail: jsonb("detail").notNull().default({}),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("idx_audit_at").on(t.at)],
);

// --- ingestion configuration -----------------------------------------------

/**
 * SFTP connection the ingester uses to pull NetMon bundles. SINGLETON: exactly
 * one row, `id = 1`. Edited by a superadmin from /settings/ingestion and read by
 * BOTH the on-demand "Sync now" (web app) and the scheduled cron Job.
 *
 * SECURITY: the secret fields (password / private key / passphrase) are stored
 * ENCRYPTED at rest — AES-256-GCM keyed off AUTH_SECRET (see src/lib/crypto/
 * secret-box.ts). A plaintext credential never touches this table or the repo.
 */
export const ingestSettings = pgTable("ingest_settings", {
  /** Singleton guard: always 1. */
  id: integer("id").primaryKey().default(1),
  host: text("host"),
  port: integer("port").notNull().default(22),
  username: text("username"),
  /** 'password' | 'key' */
  authMode: text("auth_mode").notNull().default("password"),
  /** AES-256-GCM ciphertext (base64). Null = not set / unchanged. */
  passwordEnc: text("password_enc"),
  privateKeyEnc: text("private_key_enc"),
  passphraseEnc: text("passphrase_enc"),
  /** Remote tree root to walk for *.zip bundles. */
  baseDir: text("base_dir").notNull().default("/"),
  /** Master switch: when false, scheduled + on-demand sync no-op early. */
  enabled: boolean("enabled").notNull().default(false),
  // --- automatic scheduling -------------------------------------------------
  /** When true, the cron Job auto-pulls on the cadence below. When false the
   *  remote Job no-ops and only the manual "Sync now" button pulls. */
  scheduleEnabled: boolean("schedule_enabled").notNull().default(false),
  /** How often the scheduled pull should run: 'hourly' | 'every6h' |
   *  'every12h' | 'daily'. The Job wakes hourly and skips until this much time
   *  has elapsed since last_sync_at, so charges stay near one pass per cadence. */
  scheduleFrequency: text("schedule_frequency").notNull().default("every6h"),
  // --- sensor auto-enrollment (bootstrap key) -------------------------------
  /** When true, a box presenting the shared bootstrap key may self-register and
   *  be issued its own per-sensor token. Turn off outside provisioning windows. */
  autoEnrollEnabled: boolean("auto_enroll_enabled").notNull().default(false),
  /** AES-256-GCM ciphertext of the shared bootstrap passphrase techs put on new
   *  boxes. Compared (constant-time) against the box's NETMON_BOOTSTRAP_KEY. */
  bootstrapKeyEnc: text("bootstrap_key_enc"),
  // --- last-run telemetry (surfaced on the settings page) ------------------
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  /** 'ok' | 'error' | 'running' */
  lastSyncStatus: text("last_sync_status"),
  lastSyncSummary: text("last_sync_summary"),
  updatedBy: integer("updated_by").references(() => users.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// --- ingestion bookkeeping -------------------------------------------------

/**
 * One row per pulled bundle ZIP. UNIQUE filename guarantees the nightly pull is
 * idempotent and never re-downloads (mirrors NetMon's own bundle_uploads).
 */
export const ingestedBundles = pgTable(
  "ingested_bundles",
  {
    id: serial("id").primaryKey(),
    filename: text("filename").notNull().unique(),
    districtSlug: text("district_slug"),
    schoolSlug: text("school_slug"),
    deviceSlug: text("device_slug"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    /** Where the raw ZIP was copied (Blob path). */
    blobPath: text("blob_path"),
    builtAt: timestamp("built_at", { withTimezone: true }),
    pulledAt: timestamp("pulled_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    parsedAt: timestamp("parsed_at", { withTimezone: true }),
    parseStatus: parseStatus("parse_status").notNull().default("pending"),
    parseError: text("parse_error"),
  },
  (t) => [
    index("idx_bundles_parse_status").on(t.parseStatus),
    index("idx_bundles_identity").on(
      t.districtSlug,
      t.schoolSlug,
      t.deviceSlug,
    ),
  ],
);
