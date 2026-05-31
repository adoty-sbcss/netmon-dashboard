/**
 * Server-side current-user loading and session-cookie management. Used by server
 * components and server actions (Node runtime). The Edge middleware does NOT use
 * this — it only checks the cookie signature via session.ts.
 */
import "server-only";
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
  role: "superadmin" | "user";
  isBreakGlass: boolean;
  mustChangePassword: boolean;
}

/** Load the authenticated user from the session cookie, or null. */
export async function getSessionUser(): Promise<SessionUser | null> {
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
  };
}

/** Issue/refresh the session cookie for a user. */
export async function setSessionCookie(
  uid: number,
  mustChangePassword: boolean,
): Promise<void> {
  const token = await createSessionToken(uid, { mustChangePassword });
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
