/**
 * Help Center feedback signal — the loop that tells us which articles land and,
 * crucially, what people search for and DON'T find (the data-driven backlog of
 * what to write next). One row per event; no PII beyond the optional note.
 */
import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";

export const helpEvents = pgTable(
  "help_events",
  {
    id: serial("id").primaryKey(),
    /** 'helpful' | 'unhelpful' | 'search_miss' */
    type: text("type").notNull(),
    /** article slug (for helpful/unhelpful) */
    slug: text("slug"),
    /** the search text that returned no results (for search_miss) */
    query: text("query"),
    /** optional free-text note from a thumbs-down */
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("idx_help_events_type_created").on(t.type, t.createdAt)],
);
