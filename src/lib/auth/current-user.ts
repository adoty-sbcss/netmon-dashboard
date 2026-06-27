/**
 * Server-side current-user loading and session-cookie management. Used by server
 * components and server actions (Node runtime). The Edge middleware does NOT use
 * this — it only checks the cookie signature via session.ts.
 */
import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema/app";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  createSessionToken,
  verifySessionToken,
} from "./session";

export interface SessionUser {
  id: number;
  email: string;
  displayName: string | null;
  role: "superadmin" | "user" | "viewer";
  isBreakGlass: boolean;
  mustChangePassword: boolean;
  /** Read-only (viewer) — mutations are blocked at the edge; also used to hide
   *  write affordances in the UI. */
  isReadOnly: boolean;
}

/**
 * Load the authenticated user from the session cookie, or null.
 * Wrapped in React `cache()` so the cookie verify + users SELECT runs once per
 * request even though the layout(s) and most leaf pages each call it.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const claims = await verifySessionToken(jar.get(SESSION_COOKIE)?.value);
  if (!claims) return null;

  const [u] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      isBreakGlass: users.isBreakGlass,
      mustChangePassword: users.mustChangePassword,
      disabled: users.disabled,
    })
    .from(users)
    .where(eq(users.id, claims.uid))
    .limit(1);

  if (!u || u.disabled) return null;
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    isBreakGlass: u.isBreakGlass,
    mustChangePassword: u.mustChangePassword,
    isReadOnly: u.role === "viewer",
  };
});

/** Issue/refresh the session cookie for a user. Stamps the read-only flag from the
 *  user's role so the Edge middleware can block mutations without a DB hit — this is
 *  the single chokepoint every login path (password + OIDC) funnels through. */
export async function setSessionCookie(
  uid: number,
  mustChangePassword: boolean,
): Promise<void> {
  const [u] = await db.select({ role: users.role }).from(users).where(eq(users.id, uid)).limit(1);
  const token = await createSessionToken(uid, {
    mustChangePassword,
    readOnly: u?.role === "viewer",
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

/** Clear the session cookie (logout). */
export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
