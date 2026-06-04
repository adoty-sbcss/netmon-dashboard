/**
 * In-app AI assistant — persisted conversations + messages. Scoped to a district
 * or school (so a chat sits with the data it's about) and owned by a user. The
 * assistant reads a snapshot of the scope's data (Phase 1) and answers grounded
 * in it; see src/lib/ai/chat-actions.ts.
 */
import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { districts, users } from "./app";

export const chatConversations = pgTable(
  "chat_conversations",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** 'district' | 'school' — what the chat is about. */
    scopeType: text("scope_type").notNull(),
    scopeId: integer("scope_id").notNull(),
    /** Always set (the school's district for school scope) for auth filtering. */
    districtId: integer("district_id")
      .notNull()
      .references(() => districts.id, { onDelete: "cascade" }),
    title: text("title"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_chat_conv_user_scope").on(t.userId, t.scopeType, t.scopeId, t.updatedAt),
  ],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => chatConversations.id, { onDelete: "cascade" }),
    /** 'user' | 'assistant'. */
    role: text("role").notNull(),
    content: text("content").notNull(),
    /** Provider/model that produced an assistant message (null for user turns). */
    model: text("model"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("idx_chat_msg_conv").on(t.conversationId, t.createdAt)],
);
