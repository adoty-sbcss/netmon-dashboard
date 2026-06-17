/**
 * Persistent "Issues" tracker — the durable, deduplicated view of what needs
 * attention, distilled from AI analysis runs (and later, deterministic checks).
 *
 * One row per distinct issue per scope (keyed by a stable slug of the title), NOT
 * one-per-run. Each run BUMPS a matching open issue (occurrences++, lastSeen) or
 * opens a new one; issues absent from N consecutive runs auto-RESOLVE. This is
 * the anti-fatigue, "checks itself off when it goes away, with history" list.
 */
import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { districts, users } from "./app";

export const issues = pgTable(
  "issues",
  {
    id: serial("id").primaryKey(),
    districtId: integer("district_id")
      .notNull()
      .references(() => districts.id, { onDelete: "cascade" }),
    /** 'district' | 'school' — mirrors ai_analyses / topology_snapshots. */
    scopeType: text("scope_type").notNull(),
    scopeId: integer("scope_id").notNull(),
    /** Stable dedup key within a scope: slug(title). */
    issueKey: text("issue_key").notNull(),
    severity: text("severity").notNull().default("info"),
    confidence: text("confidence"),
    title: text("title").notNull(),
    detail: text("detail"),
    recommendation: text("recommendation"),
    /** 'open' | 'acknowledged' | 'resolved'. */
    status: text("status").notNull().default("open"),
    /** Where it came from: 'ai' | 'ai-topology' | 'rule'. */
    source: text("source").notNull().default("ai"),
    occurrences: integer("occurrences").notNull().default(1),
    /** Consecutive analysis runs this issue was absent — auto-resolves at the cap. */
    missedRuns: integer("missed_runs").notNull().default(0),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    acknowledgedBy: integer("acknowledged_by").references(() => users.id, { onDelete: "set null" }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    note: text("note"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("uq_issue_scope_key").on(t.scopeType, t.scopeId, t.issueKey),
    index("idx_issue_district_status").on(t.districtId, t.status),
    // Muted-issue + school issue-list reads filter (scope_type, scope_id, status).
    index("idx_issue_scope_status").on(t.scopeType, t.scopeId, t.status),
  ],
);
