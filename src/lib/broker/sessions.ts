/**
 * Shared helpers for the zero-secret broker callbacks (validate / alive /
 * transcript). The broker holds no secrets and no DB access; these endpoints
 * are authenticated purely by the high-entropy per-session token (validate) or
 * recordKey (alive / transcript) the dashboard minted in openConsoleSessionAction.
 */
import "server-only";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { shellSessions } from "@/db/schema/management";

export type ShellSession = typeof shellSessions.$inferSelect;

export function isTerminal(status: string): boolean {
  return status === "closed" || status === "killed" || status === "expired";
}

/** A session is live if it's not terminal and hasn't passed its time-box. */
export function isAlive(s: Pick<ShellSession, "status" | "expiresAt">): boolean {
  return !isTerminal(s.status) && s.expiresAt.getTime() > Date.now();
}

export async function getSession(sid: string): Promise<ShellSession | null> {
  const [s] = await db.select().from(shellSessions).where(eq(shellSessions.id, sid)).limit(1);
  return s ?? null;
}

/** Lazily flip a past-deadline session to 'expired' so /alive + /validate agree. */
export async function expireIfPast(s: ShellSession): Promise<boolean> {
  if (!isTerminal(s.status) && s.expiresAt.getTime() <= Date.now()) {
    await db
      .update(shellSessions)
      .set({ status: "expired", closedAt: new Date() })
      .where(eq(shellSessions.id, s.id));
    return true;
  }
  return false;
}
