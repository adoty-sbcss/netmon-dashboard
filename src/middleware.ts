/**
 * Edge middleware — the airtight read-only guard for `viewer` accounts.
 *
 * A viewer session is marked read-only in its signed session token (session.ts
 * `ro`). Here we reject EVERY mutation — any non-GET request, which covers all
 * server actions and API writes (they're POST) — for such a session. So a viewer
 * can load and read any page they're scoped to, but can NEVER change anything,
 * regardless of what each individual server action checks. This is the single
 * enforcement point, so the read-only guarantee can't be missed action-by-action.
 *
 * Normal sessions (no `ro`) and all reads short-circuit straight to next(), so this
 * is zero behaviour change for everyone except viewers attempting a write.
 *
 * Edge-safe: imports only session.ts (Web Crypto + AUTH_SECRET; no DB, no Node-only
 * deps).
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function middleware(req: NextRequest): Promise<NextResponse> {
  // Reads always pass — keep the hot path free of any token work.
  if (READ_METHODS.has(req.method.toUpperCase())) return NextResponse.next();

  const claims = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (claims?.ro) {
    return new NextResponse("This is a read-only account — that action isn't permitted.", {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return NextResponse.next();
}

export const config = {
  // Run on every route EXCEPT Next internals + static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
