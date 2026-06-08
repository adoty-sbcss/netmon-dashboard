"use server";

/**
 * Server actions for the global in-app assistant (M1). One rolling "session"
 * conversation per user (scopeType 'global'); "Reset" starts a fresh one and the
 * old transcript stays recorded. Every turn derives the CURRENT page's scope from
 * the pathname, re-checks district access server-side, and only feeds the model
 * data for a site the user is allowed to see. Client-passed paths/ids are never
 * trusted.
 */
import { and, asc, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { chatConversations, chatMessages } from "@/db/schema/chat";
import { getSessionUser } from "@/lib/auth/current-user";
import { getUserScope, scopeAllowsDistrict, type UserScope } from "@/lib/auth/scope";
import { getDistrictBySlug, getSchoolBySlug } from "@/db/queries";

import { aiChatWithTools, type ChatMsg } from "./chat";
import { buildAssistantSystemPrompt } from "./chat-prompt";
import { getAiSettings } from "./settings";
import { ASSISTANT_TOOLS, buildToolExecutor, getAllowedSites } from "./chat-tools";
import type { AnalysisScope, ChatMessage } from "./types";

const MAX_HISTORY = 24;
const MAX_INPUT_CHARS = 4000;
// AI-3: a session is considered stale after this much inactivity; opening the
// widget then starts a fresh conversation (the old transcript stays recorded).
const SESSION_IDLE_MS = 60 * 60 * 1000;

// Top-level dashboard routes that are NOT district slugs.
const RESERVED = new Set(["settings", "account", "admin", "login", "api"]);

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

/** Derive the scope the user is viewing from a dashboard pathname, bounded by
 *  their district access. Returns null (app-only) for non-site or unauthorized pages. */
async function resolveScope(
  pathname: string,
  scope: UserScope,
): Promise<AnalysisScope | null> {
  const segs = (pathname || "").split("/").filter(Boolean);
  if (segs.length === 0) return null;
  const districtSlug = decodeURIComponent(segs[0]);
  if (RESERVED.has(districtSlug)) return null;

  const district = await getDistrictBySlug(districtSlug);
  if (!district) return null;
  if (!scopeAllowsDistrict(scope, district.id)) return null;

  if (segs.length >= 2) {
    const schoolSlug = decodeURIComponent(segs[1]);
    const school = await getSchoolBySlug(district.id, schoolSlug);
    if (school) {
      return {
        type: "school",
        id: school.id,
        districtId: district.id,
        label: `${district.name || district.slug} — ${school.name || school.slug}`,
      };
    }
  }
  return {
    type: "district",
    id: district.id,
    districtId: district.id,
    label: district.name || district.slug,
  };
}

/** Load the user's active (most recent) session conversation. */
export async function getAssistantSession(): Promise<{
  conversationId: number | null;
  messages: ChatMsg[];
  error?: string;
}> {
  const user = await getSessionUser();
  if (!user) return { conversationId: null, messages: [], error: "Not authenticated." };

  const [conv] = await db
    .select()
    .from(chatConversations)
    .where(
      and(
        eq(chatConversations.userId, user.id),
        eq(chatConversations.scopeType, "global"),
      ),
    )
    .orderBy(desc(chatConversations.updatedAt))
    .limit(1);
  if (!conv) return { conversationId: null, messages: [] };

  // AI-3: auto-reset after 60 min of inactivity. Don't resume a stale session —
  // return an empty one so the next message opens a fresh conversation. The old
  // transcript is untouched (still visible in the superadmin viewer).
  if (conv.updatedAt && Date.now() - conv.updatedAt.getTime() > SESSION_IDLE_MS) {
    return { conversationId: null, messages: [] };
  }

  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conv.id))
    .orderBy(asc(chatMessages.createdAt));
  return { conversationId: conv.id, messages: rows.map(toMsg) };
}

/** Send a message in the session; persist both turns; return the assistant reply.
 *  `conversationId` null starts a new session (the "Reset" path). */
export async function sendAssistantMessage(
  pathname: string,
  conversationId: number | null,
  text: string,
): Promise<{ conversationId: number; message: ChatMsg } | { error: string }> {
  const user = await getSessionUser();
  if (!user) return { error: "Not authenticated." };

  const clean = text.trim().slice(0, MAX_INPUT_CHARS);
  if (!clean) return { error: "Empty message." };

  let convId = conversationId;
  if (convId != null) {
    const [conv] = await db
      .select()
      .from(chatConversations)
      .where(eq(chatConversations.id, convId))
      .limit(1);
    if (!conv || conv.userId !== user.id) return { error: "Conversation not found." };
    // AI-3: if the widget sat open past the idle window, don't append to the
    // stale conversation — start a fresh one (matches getAssistantSession).
    if (conv.updatedAt && Date.now() - conv.updatedAt.getTime() > SESSION_IDLE_MS) {
      convId = null;
    }
  }
  if (convId == null) {
    const [created] = await db
      .insert(chatConversations)
      .values({
        userId: user.id,
        scopeType: "global",
        scopeId: null,
        districtId: null,
        title: clean.slice(0, 80),
      })
      .returning({ id: chatConversations.id });
    convId = created.id;
  }

  await db
    .insert(chatMessages)
    .values({ conversationId: convId, role: "user", content: clean });

  const scope = await getUserScope(user);
  const sites = await getAllowedSites(scope);
  const pageScope = await resolveScope(pathname, scope);
  const current = pageScope
    ? {
        schoolId: pageScope.type === "school" ? pageScope.id : null,
        label: pageScope.label,
      }
    : null;
  const settings = await getAiSettings();
  const name = settings.assistantName?.trim() || "NetMon Assistant";
  const base = buildAssistantSystemPrompt({
    instructions: settings.assistantInstructions,
    sites,
    current,
  });
  const system = `Your name is "${name}". Refer to yourself by this name.\n\n${base}`;

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
  const execute = buildToolExecutor(sites);
  try {
    const r = await aiChatWithTools(
      { system, messages: recent, tools: ASSISTANT_TOOLS, execute },
      { maxOutputTokens: 1024 },
    );
    assistantText = r.text?.trim() || "(no response)";
    model = r.model;
    tokensIn = r.tokensIn;
    tokensOut = r.tokensOut;
  } catch (err) {
    // Surface the real reason (e.g. rate limit / not configured) to the user.
    return { error: `Assistant couldn't respond: ${(err as Error).message}` };
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

  // Stamp the latest page context on the conversation (for the superadmin viewer).
  await db
    .update(chatConversations)
    .set({ updatedAt: new Date(), districtId: pageScope?.districtId ?? null })
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
