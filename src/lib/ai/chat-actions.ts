"use server";

/**
 * Server actions for the in-app assistant (per-school, Phase 1). Every action
 * re-checks auth + district scope server-side and verifies conversation ownership
 * — the client-passed slugs/ids are never trusted. The model reads a snapshot of
 * the school's data (buildChatSystemPrompt) and answers grounded in it.
 */
import { and, asc, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { chatConversations, chatMessages } from "@/db/schema/chat";
import { getSessionUser } from "@/lib/auth/current-user";
import { getUserScope, scopeAllowsDistrict } from "@/lib/auth/scope";
import { getDistrictBySlug, getSchoolBySlug } from "@/db/queries";

import { aiChat, type ChatMsg } from "./chat";
import { buildChatSystemPrompt } from "./chat-prompt";
import type { ChatMessage } from "./types";

const MAX_HISTORY = 20; // turns sent back to the model
const MAX_INPUT_CHARS = 4000;

type SchoolCtx =
  | { error: string }
  | {
      user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;
      district: { id: number; slug: string; name: string | null };
      school: { id: number; slug: string; name: string | null };
    };

async function authedSchoolScope(
  districtSlug: string,
  schoolSlug: string,
): Promise<SchoolCtx> {
  const user = await getSessionUser();
  if (!user) return { error: "Not authenticated." };
  const district = await getDistrictBySlug(districtSlug);
  if (!district) return { error: "District not found." };
  const scope = await getUserScope(user);
  if (!scopeAllowsDistrict(scope, district.id)) {
    return { error: "Not authorized for this district." };
  }
  const school = await getSchoolBySlug(district.id, schoolSlug);
  if (!school) return { error: "School not found." };
  return { user, district, school };
}

const toMsg = (m: {
  id: number;
  role: string;
  content: string;
  createdAt: Date;
}): ChatMsg => ({
  id: m.id,
  role: m.role === "assistant" ? "assistant" : "user",
  content: m.content,
  createdAt: m.createdAt,
});

/** Load this user's existing conversation for the school (no creation). */
export async function getSchoolChat(
  districtSlug: string,
  schoolSlug: string,
): Promise<{ conversationId: number | null; messages: ChatMsg[]; error?: string }> {
  const ctx = await authedSchoolScope(districtSlug, schoolSlug);
  if ("error" in ctx) return { conversationId: null, messages: [], error: ctx.error };

  const [conv] = await db
    .select()
    .from(chatConversations)
    .where(
      and(
        eq(chatConversations.userId, ctx.user.id),
        eq(chatConversations.scopeType, "school"),
        eq(chatConversations.scopeId, ctx.school.id),
      ),
    )
    .orderBy(desc(chatConversations.updatedAt))
    .limit(1);
  if (!conv) return { conversationId: null, messages: [] };

  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conv.id))
    .orderBy(asc(chatMessages.createdAt));
  return { conversationId: conv.id, messages: rows.map(toMsg) };
}

/** Send a user message; persist both turns; return the assistant reply. */
export async function sendSchoolChat(
  districtSlug: string,
  schoolSlug: string,
  conversationId: number | null,
  text: string,
): Promise<{ conversationId: number; message: ChatMsg } | { error: string }> {
  const ctx = await authedSchoolScope(districtSlug, schoolSlug);
  if ("error" in ctx) return { error: ctx.error };
  const { user, district, school } = ctx;

  const clean = text.trim().slice(0, MAX_INPUT_CHARS);
  if (!clean) return { error: "Empty message." };

  // Resolve or create the conversation; verify ownership when an id is supplied.
  let convId = conversationId;
  if (convId != null) {
    const [conv] = await db
      .select()
      .from(chatConversations)
      .where(eq(chatConversations.id, convId))
      .limit(1);
    if (
      !conv ||
      conv.userId !== user.id ||
      conv.scopeType !== "school" ||
      conv.scopeId !== school.id
    ) {
      return { error: "Conversation not found." };
    }
  } else {
    const [created] = await db
      .insert(chatConversations)
      .values({
        userId: user.id,
        scopeType: "school",
        scopeId: school.id,
        districtId: district.id,
        title: clean.slice(0, 80),
      })
      .returning({ id: chatConversations.id });
    convId = created.id;
  }

  await db
    .insert(chatMessages)
    .values({ conversationId: convId, role: "user", content: clean });

  const label = `${district.name || district.slug} — ${school.name || school.slug}`;
  const system = await buildChatSystemPrompt({
    type: "school",
    id: school.id,
    districtId: district.id,
    label,
  });

  const history = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, convId))
    .orderBy(asc(chatMessages.createdAt));
  const recent: ChatMessage[] = history.slice(-MAX_HISTORY).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));

  let assistantText: string;
  let model: string | null = null;
  let tokensIn: number | null = null;
  let tokensOut: number | null = null;
  try {
    const r = await aiChat({ system, messages: recent }, { maxOutputTokens: 1024 });
    assistantText = r.text?.trim() || "(no response)";
    model = r.model;
    tokensIn = r.tokensIn;
    tokensOut = r.tokensOut;
  } catch (err) {
    assistantText = `Sorry — I couldn't answer that right now (${(err as Error).message}).`;
  }

  const [saved] = await db
    .insert(chatMessages)
    .values({
      conversationId: convId,
      role: "assistant",
      content: assistantText,
      model,
      tokensIn,
      tokensOut,
    })
    .returning({ id: chatMessages.id, createdAt: chatMessages.createdAt });
  await db
    .update(chatConversations)
    .set({ updatedAt: new Date() })
    .where(eq(chatConversations.id, convId));

  return {
    conversationId: convId,
    message: {
      id: saved.id,
      role: "assistant",
      content: assistantText,
      createdAt: saved.createdAt,
    },
  };
}
