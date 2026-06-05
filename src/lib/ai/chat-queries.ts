/**
 * Read side for the in-app assistant transcripts — superadmin only (the pages
 * that call these gate on role). Lists recorded conversations and loads a single
 * transcript. See src/app/(dashboard)/settings/ai/conversations.
 */
import "server-only";
import { asc, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { chatConversations, chatMessages } from "@/db/schema/chat";
import { users, districts } from "@/db/schema/app";

export interface ConversationListItem {
  id: number;
  userEmail: string | null;
  userName: string | null;
  districtName: string | null;
  title: string | null;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export async function listConversations(limit = 100): Promise<ConversationListItem[]> {
  const rows = await db
    .select({
      id: chatConversations.id,
      userEmail: users.email,
      userName: users.displayName,
      districtName: districts.name,
      title: chatConversations.title,
      messageCount: sql<number>`(select count(*) from ${chatMessages} where ${chatMessages.conversationId} = ${chatConversations.id})`,
      createdAt: chatConversations.createdAt,
      updatedAt: chatConversations.updatedAt,
    })
    .from(chatConversations)
    .leftJoin(users, eq(chatConversations.userId, users.id))
    .leftJoin(districts, eq(chatConversations.districtId, districts.id))
    .orderBy(desc(chatConversations.updatedAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, messageCount: Number(r.messageCount ?? 0) }));
}

export interface ConversationDetail {
  id: number;
  userEmail: string | null;
  userName: string | null;
  districtName: string | null;
  createdAt: Date;
  updatedAt: Date;
  messages: {
    id: number;
    role: string;
    content: string;
    model: string | null;
    createdAt: Date;
  }[];
}

export async function getConversationDetail(id: number): Promise<ConversationDetail | null> {
  const [conv] = await db
    .select({
      id: chatConversations.id,
      userEmail: users.email,
      userName: users.displayName,
      districtName: districts.name,
      createdAt: chatConversations.createdAt,
      updatedAt: chatConversations.updatedAt,
    })
    .from(chatConversations)
    .leftJoin(users, eq(chatConversations.userId, users.id))
    .leftJoin(districts, eq(chatConversations.districtId, districts.id))
    .where(eq(chatConversations.id, id))
    .limit(1);
  if (!conv) return null;

  const msgs = await db
    .select({
      id: chatMessages.id,
      role: chatMessages.role,
      content: chatMessages.content,
      model: chatMessages.model,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, id))
    .orderBy(asc(chatMessages.createdAt));

  return { ...conv, messages: msgs };
}
