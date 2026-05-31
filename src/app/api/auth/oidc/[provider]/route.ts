import { NextResponse, type NextRequest } from "next/server";

import {
  OAUTH_STATE_COOKIE,
  appOrigin,
  authorizationUrl,
  isProvider,
  providerEnabled,
  redirectUri,
} from "@/lib/auth/oidc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Start the OAuth dance: set a state cookie and redirect to the provider. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const origin = appOrigin(req);
  if (!isProvider(provider) || !providerEnabled(provider)) {
    return NextResponse.redirect(new URL("/login?error=provider", origin));
  }

  const state = crypto.randomUUID();
  const url = authorizationUrl(provider, redirectUri(req, provider), state);
  if (!url) return NextResponse.redirect(new URL("/login?error=provider", origin));

  const res = NextResponse.redirect(url);
  res.cookies.set(OAUTH_STATE_COOKIE, `${provider}:${state}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
