/**
 * Sign-out endpoint. A plain POST (not a server action) so it lives under the
 * /api/auth/* namespace that the route gate (proxy.ts) lets through BEFORE the
 * read-only write-block — otherwise a viewer (read-only) session could never
 * sign out. Clears the session cookie and redirects to the login page.
 */
import { type NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { auditLog } from "@/db/schema/app";
import { getSessionUser } from "@/lib/auth/current-user";
import { SESSION_COOKIE } from "@/lib/auth/session";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = await getSessionUser();
  if (user) {
    try {
      await db
        .insert(auditLog)
        .values({ actorType: "user", actor: user.email, action: "logout" });
    } catch {
      // best-effort audit; never block sign-out on it
    }
  }
  // 303 → the browser re-issues the post-logout navigation as a GET.
  const res = NextResponse.redirect(new URL("/login", req.url), 303);
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
