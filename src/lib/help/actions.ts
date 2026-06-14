"use server";

import { sql, desc, eq, and, gt } from "drizzle-orm";

import { db } from "@/db";
import { helpEvents } from "@/db/schema/help";
import { getSessionUser } from "@/lib/auth/current-user";

/** Record a thumbs up/down on an article (the "is this useful?" signal). */
export async function recordHelpFeedback(
  slug: string,
  helpful: boolean,
  note?: string,
): Promise<{ ok: true } | { error: string }> {
  const user = await getSessionUser();
  if (!user) return { error: "Not signed in." };
  if (!slug) return { error: "Missing article." };
  await db.insert(helpEvents).values({
    type: helpful ? "helpful" : "unhelpful",
    slug: slug.slice(0, 120),
    note: note ? note.trim().slice(0, 500) || null : null,
  });
  return { ok: true };
}

/** Log a search that returned nothing — the data-driven "what to write next" list. */
export async function logHelpSearchMiss(query: string): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;
  const q = query.trim();
  if (q.length < 2) return;
  await db.insert(helpEvents).values({ type: "search_miss", query: q.slice(0, 200) });
}

export interface HelpInsights {
  searchMisses: { query: string; count: number }[];
  unhelpful: { slug: string | null; note: string | null; at: Date }[];
  byArticle: { slug: string; helpful: number; unhelpful: number }[];
}

/** Superadmin view of the feedback signal (last 90 days). */
export async function getHelpInsights(): Promise<HelpInsights | { error: string }> {
  const user = await getSessionUser();
  if (!user || user.role !== "superadmin") return { error: "Forbidden." };
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const misses = await db
    .select({
      query: sql<string>`lower(${helpEvents.query})`,
      count: sql<number>`count(*)::int`,
    })
    .from(helpEvents)
    .where(and(eq(helpEvents.type, "search_miss"), gt(helpEvents.createdAt, since)))
    .groupBy(sql`lower(${helpEvents.query})`)
    .orderBy(desc(sql`count(*)`))
    .limit(30);

  const unhelpful = await db
    .select({ slug: helpEvents.slug, note: helpEvents.note, at: helpEvents.createdAt })
    .from(helpEvents)
    .where(and(eq(helpEvents.type, "unhelpful"), gt(helpEvents.createdAt, since)))
    .orderBy(desc(helpEvents.createdAt))
    .limit(30);

  const votes = await db
    .select({
      slug: helpEvents.slug,
      type: helpEvents.type,
      count: sql<number>`count(*)::int`,
    })
    .from(helpEvents)
    .where(
      and(
        sql`${helpEvents.type} in ('helpful','unhelpful')`,
        gt(helpEvents.createdAt, since),
      ),
    )
    .groupBy(helpEvents.slug, helpEvents.type);

  const byMap = new Map<string, { slug: string; helpful: number; unhelpful: number }>();
  for (const v of votes) {
    if (!v.slug) continue;
    const e = byMap.get(v.slug) ?? { slug: v.slug, helpful: 0, unhelpful: 0 };
    if (v.type === "helpful") e.helpful = v.count;
    else e.unhelpful = v.count;
    byMap.set(v.slug, e);
  }

  return {
    searchMisses: misses.map((m) => ({ query: m.query, count: m.count })),
    unhelpful: unhelpful.map((u) => ({ slug: u.slug, note: u.note, at: u.at })),
    byArticle: [...byMap.values()].sort((a, b) => b.unhelpful - a.unhelpful),
  };
}
