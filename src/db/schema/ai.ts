/**
 * AI analysis reports — durable tier (survives the 30-day purge of the
 * time-series tables, like health_rollup_daily and the entities_* / topology
 * snapshots). See docs/DESIGN.md §10.
 *
 * A single ANALYSIS RUN fans out to every configured model provider and writes
 * ONE ROW PER MODEL, all sharing the same `runId` + window + trigger. The
 * dashboard groups rows by `runId` to render the side-by-side model comparison,
 * so adding a third model never changes this schema.
 *
 * Scope mirrors topology_snapshots: ('district' | 'school', scopeId). districtId
 * is ALWAYS set (the school's district for school scope) so authorization can
 * filter on it directly without a join.
 */
import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  doublePrecision,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { districts, users } from "./app";

/** One finding emitted by a model. Mirrors the rule-based `findings` shape so the
 *  UI can reuse SeverityBadge. `evidence` cites the source data the model used. */
export interface AiFinding {
  /** 'critical' | 'high' | 'medium' | 'low' | 'info' (matches SeverityBadge). */
  severity: string;
  /** 'definite' | 'suggestive' — how strongly the evidence supports it. */
  confidence: string;
  title: string;
  detail: string;
  /** What in the data backs this up: e.g. "dns_resolver_health: resolver 10.0.0.1 mean_ms=480". */
  evidence: string;
  /** Concrete next check the tech should run. */
  recommendation: string;
}

export const aiAnalyses = pgTable(
  "ai_analyses",
  {
    id: serial("id").primaryKey(),
    /** Groups the per-model rows produced by one run. */
    runId: text("run_id").notNull(),
    /** 'district' | 'school' (mirrors topology_snapshots.scope_type). */
    scopeType: text("scope_type").notNull(),
    scopeId: integer("scope_id").notNull(),
    /** Always set — the district for any scope — for cheap auth filtering. */
    districtId: integer("district_id")
      .notNull()
      .references(() => districts.id, { onDelete: "cascade" }),
    /** Analyzed window (typically one local day for the scheduled run). */
    windowStart: timestamp("window_start", { withTimezone: true }),
    windowEnd: timestamp("window_end", { withTimezone: true }),
    /** 'scheduled' | 'manual'. */
    trigger: text("trigger").notNull(),
    /** 'general' (the daily health analysis) | 'topology' (physical-map design
     *  review). Lets the two analyses coexist without mixing in the UI. */
    kind: text("kind").notNull().default("general"),
    /** 'azure-openai' | 'anthropic' | ... */
    providerId: text("provider_id").notNull(),
    /** Concrete model/deployment used, e.g. "gpt-4o" or "claude-opus-4-8". */
    model: text("model"),
    /** 'running' | 'ok' | 'failed'. Inserted as 'running', updated on finish. */
    status: text("status").notNull().default("running"),
    /** Readable narrative report. */
    prose: text("prose"),
    /** Structured findings for severity-badged cards. */
    findings: jsonb("findings").$type<AiFinding[]>().notNull().default([]),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    costUsd: doublePrecision("cost_usd"),
    latencyMs: integer("latency_ms"),
    error: text("error"),
    /** Null for scheduled runs; the requesting user for manual runs. */
    requestedBy: integer("requested_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_ai_analyses_scope").on(
      t.districtId,
      t.scopeType,
      t.scopeId,
      t.createdAt,
    ),
    index("idx_ai_analyses_run").on(t.runId),
  ],
);

/**
 * Per-provider configuration, edited from /settings/ai (superadmin). One row per
 * provider id ('azure-openai' | 'openai' | 'anthropic'). The API key is stored
 * AES-256-GCM ENCRYPTED (secret-box, keyed off AUTH_SECRET) — same posture as the
 * SFTP creds in ingest_settings. Non-secret fields (endpoint, model, org/project)
 * are plain. Env vars remain a fallback when a row is absent.
 */
export const aiProviderSettings = pgTable("ai_provider_settings", {
  /** Stable provider id; also the PK. */
  providerId: text("provider_id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  /** Deployment name (Azure) or model id (OpenAI / Anthropic). */
  model: text("model"),
  /** AES-256-GCM ciphertext (null = not set / unchanged). */
  apiKeyEnc: text("api_key_enc"),
  endpoint: text("endpoint"), // Azure OpenAI endpoint
  apiVersion: text("api_version"), // Azure OpenAI
  organization: text("organization"), // OpenAI org id
  project: text("project"), // OpenAI project id
  updatedBy: integer("updated_by").references(() => users.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Global AI settings — SINGLETON (id = 1). Schedule for the daily Job, the
 * per-run output-token bound, and an ADVISORY monthly spend figure (tracked +
 * displayed, not yet enforced — see docs/DESIGN.md §10).
 */
export const aiSettings = pgTable("ai_settings", {
  id: integer("id").primaryKey().default(1),
  /** When true the daily Job runs; when false it no-ops (manual button still works). */
  scheduleEnabled: boolean("schedule_enabled").notNull().default(true),
  /** Cron (UTC) for the daily run. */
  scheduleCron: text("schedule_cron").notNull().default("0 2 * * *"),
  /** Per-run max output tokens handed to every model. */
  maxOutputTokens: integer("max_output_tokens").notNull().default(8192),
  /** Advisory monthly spend target (USD). Displayed against tracked usage; not enforced. */
  monthlySpendCapUsd: doublePrecision("monthly_spend_cap_usd"),
  /** Editable persona/behavior for the in-app assistant (Settings → AI). Null =
   *  built-in default. App facts + anti-hallucination grounding are appended by
   *  the system and are not editable here. */
  assistantInstructions: text("assistant_instructions"),
  /** Display name for the in-app assistant (null → "NetMon Assistant"). */
  assistantName: text("assistant_name"),
  /** Opening greeting shown when a chat session is empty (null → built-in text). */
  assistantGreeting: text("assistant_greeting"),
  /** Avatar stored inline as base64 + mime (mirrors branding_settings); both null
   *  → the default sparkle icon. */
  assistantAvatarMime: text("assistant_avatar_mime"),
  assistantAvatarData: text("assistant_avatar_data"),
  updatedBy: integer("updated_by").references(() => users.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * GLOBAL security analysis runs — the dashboard reviewing its OWN attack surface
 * (failed logins, enrollment probes, sensor-auth failures, …). UNLIKE ai_analyses
 * these have NO district: the security_events they read are about the public
 * app's perimeter, not any one tenant, so the audience is the superadmin. One run
 * still fans out to every active provider (shared runId) and stores one row per
 * model — mirroring ai_analyses so the UI reuses the same SeverityBadge/finding
 * cards. Findings surface on the superadmin Security page (no per-district issues
 * reconciliation). Reuses the AiFinding shape.
 */
export const securityAnalyses = pgTable(
  "security_analyses",
  {
    id: serial("id").primaryKey(),
    /** Groups the per-model rows produced by one run. */
    runId: text("run_id").notNull(),
    /** Analyzed window (typically the last 24h). */
    windowStart: timestamp("window_start", { withTimezone: true }),
    windowEnd: timestamp("window_end", { withTimezone: true }),
    /** 'scheduled' | 'manual'. */
    trigger: text("trigger").notNull(),
    /** How many security_events fell in the window (0 ⇒ scheduled run is skipped). */
    eventCount: integer("event_count"),
    /** 'azure-openai' | 'anthropic' | ... */
    providerId: text("provider_id").notNull(),
    model: text("model"),
    /** 'running' | 'ok' | 'failed'. */
    status: text("status").notNull().default("running"),
    prose: text("prose"),
    findings: jsonb("findings").$type<AiFinding[]>().notNull().default([]),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    costUsd: doublePrecision("cost_usd"),
    latencyMs: integer("latency_ms"),
    error: text("error"),
    /** Null for scheduled runs; the requesting superadmin for manual runs. */
    requestedBy: integer("requested_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_security_analyses_created").on(t.createdAt),
    index("idx_security_analyses_run").on(t.runId),
  ],
);
