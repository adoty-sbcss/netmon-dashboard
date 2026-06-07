/**
 * Route gate (Edge runtime; Next.js "proxy" convention, formerly "middleware").
 * Verifies the session cookie's signature only — no DB access here.
 * Authorization (grants/scoping) is enforced server-side in the data layer; this
 * just ensures a valid, unexpired session and funnels users with a pending
 * password change to the change-password screen.
 */
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

const LOGIN_PATH = "/login";
const CHANGE_PW_PATH = "/account/change-password";

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // OAuth/OIDC endpoints must be reachable while signed out (the sign-in dance
  // happens before a session exists). They guard themselves.
  if (pathname.startsWith("/api/auth/")) return NextResponse.next();

  // Public brand assets (logo/favicon). Must load for signed-out users — the
  // login page shows the logo and the browser fetches the favicon with no
  // session. These serve only public branding.
  if (pathname.startsWith("/branding/")) return NextResponse.next();

  // Sensor check-in endpoints authenticate with an enrollment token (Bearer),
  // not a user session — let them through; they guard themselves. (Other
  // /api/sensor/* routes, like config-backup download, still require a session.)
  if (
    pathname === "/api/sensor/checkin" ||
    pathname === "/api/sensor/result" ||
    pathname === "/api/sensor/enroll" ||
    pathname === "/api/sensor/iperf-result"
  ) {
    return NextResponse.next();
  }

  // Tunnel-broker callbacks (validate / alive / transcript) are called by the
  // zero-secret broker server-to-server, NOT by a browser session. They
  // authenticate themselves with the high-entropy per-session token / recordKey.
  // Without this exemption the broker's POSTs get 307'd to /login and no console
  // session can ever validate.
  if (pathname.startsWith("/api/broker/")) {
    return NextResponse.next();
  }

  const claims = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);

  const isLogin = pathname === LOGIN_PATH;
  const isChangePw = pathname === CHANGE_PW_PATH;

  // Unauthenticated: only the login page is reachable.
  if (!claims) {
    if (isLogin) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = LOGIN_PATH;
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Authenticated but must change password: trap on the change-password page.
  if (claims.pwc && !isChangePw) {
    const url = req.nextUrl.clone();
    url.pathname = CHANGE_PW_PATH;
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Already signed in — keep them out of the login page.
  if (isLogin) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except Next internals and static asset files.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?)$).*)",
  ],
};
