import { NextResponse, type NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { users, auditLog } from "@/db/schema/app";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  createSessionToken,
} from "@/lib/auth/session";
import {
  OAUTH_STATE_COOKIE,
  appOrigin,
  exchangeCodeForEmail,
  isProvider,
  providerEnabled,
  redirectUri,
} from "@/lib/auth/oidc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function audit(actor: string, action: string, detail: Record<string, unknown> = {}) {
  try {
    await db.insert(auditLog).values({ actorType: "user", actor, action, detail });
  } catch {
    // best-effort
  }
}

/** OAuth callback: verify state, exchange code, match the email allowlist. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const origin = appOrigin(req);
  const fail = (e: string) => NextResponse.redirect(new URL(`/login?error=${e}`, origin));

  if (!isProvider(provider) || !providerEnabled(provider)) return fail("provider");

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!code || !state || cookieState !== `${provider}:${state}`) return fail("state");

  const email = await exchangeCodeForEmail(provider, code, redirectUri(req, provider));
  if (!email) return fail("oidc");

  const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!u || u.disabled) {
    await audit(email, "login_denied", { provider, reason: u ? "disabled" : "not_provisioned" });
    return fail("denied");
  }

  await db.update(users).set({ lastLoginAt: sql`now()` }).where(eq(users.id, u.id));
  await audit(u.email, "login_ok", { provider });

  const token = await createSessionToken(u.id, { mustChangePassword: u.mustChangePassword });
  const res = NextResponse.redirect(
    new URL(u.mustChangePassword ? "/account/change-password" : "/", origin),
  );
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
