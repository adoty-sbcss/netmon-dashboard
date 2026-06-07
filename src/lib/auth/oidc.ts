/**
 * Minimal OIDC (OAuth2 authorization-code) for Google + Microsoft Entra.
 *
 * Confidential web client with a client secret, so we rely on a signed `state`
 * cookie for CSRF and trust the id_token returned over the TLS back-channel
 * token endpoint (no JWKS round-trip needed — the token came straight from the
 * provider). We only extract the verified email; the users table is the
 * allowlist (admin adds the email on /settings/users).
 *
 * Activated per provider when its client id + secret env vars are present:
 *   Google:    AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET
 *   Microsoft: AUTH_MICROSOFT_ENTRA_ID_ID, AUTH_MICROSOFT_ENTRA_ID_SECRET,
 *              AUTH_MICROSOFT_ENTRA_ID_TENANT (optional, default "common")
 *
 * Redirect URI base: APP_ORIGIN (always set in production). We deliberately do
 * NOT trust the attacker-controllable x-forwarded-host header in production —
 * that would let a forged Host steer the OAuth redirect_uri. The header fallback
 * is dev-only convenience.
 */
import "server-only";

export type Provider = "google" | "microsoft";
export const PROVIDERS: Provider[] = ["google", "microsoft"];
export const OAUTH_STATE_COOKIE = "nm_oauth_state";

interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  scope: string;
  extra: Record<string, string>;
}

function providerConfig(p: Provider): ProviderConfig | null {
  if (p === "google") {
    const clientId = process.env.AUTH_GOOGLE_ID;
    const clientSecret = process.env.AUTH_GOOGLE_SECRET;
    if (!clientId || !clientSecret) return null;
    return {
      clientId,
      clientSecret,
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scope: "openid email profile",
      extra: { access_type: "online", prompt: "select_account" },
    };
  }
  if (p === "microsoft") {
    const clientId = process.env.AUTH_MICROSOFT_ENTRA_ID_ID;
    const clientSecret = process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET;
    if (!clientId || !clientSecret) return null;
    const tenant = process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT || "common";
    return {
      clientId,
      clientSecret,
      authUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
      tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      scope: "openid email profile",
      extra: { prompt: "select_account" },
    };
  }
  return null;
}

export function isProvider(v: string): v is Provider {
  return v === "google" || v === "microsoft";
}

export function providerEnabled(p: Provider): boolean {
  return providerConfig(p) !== null;
}

export function enabledProviders(): Provider[] {
  return PROVIDERS.filter(providerEnabled);
}

export function providerLabel(p: Provider): string {
  return p === "google" ? "Google" : "Microsoft";
}

/** Public origin for building the redirect URI. */
export function appOrigin(req: Request): string {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN.replace(/\/$/, "");
  // No APP_ORIGIN configured. In production, refuse to trust forwarded Host
  // headers (an attacker could forge them to hijack the OAuth redirect_uri);
  // fail closed to the request's own origin instead. The header-derived origin
  // is dev-only convenience.
  if (process.env.NODE_ENV === "production") {
    return new URL(req.url).origin;
  }
  const h = req.headers;
  const proto = h.get("x-forwarded-proto") || "https";
  const host = h.get("x-forwarded-host") || h.get("host");
  if (host) return `${proto}://${host}`;
  return new URL(req.url).origin;
}

export function redirectUri(req: Request, p: Provider): string {
  return `${appOrigin(req)}/api/auth/oidc/${p}/callback`;
}

export function authorizationUrl(p: Provider, redirect: string, state: string): string | null {
  const cfg = providerConfig(p);
  if (!cfg) return null;
  const u = new URL(cfg.authUrl);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", redirect);
  u.searchParams.set("scope", cfg.scope);
  u.searchParams.set("state", state);
  for (const [k, v] of Object.entries(cfg.extra)) u.searchParams.set(k, v);
  return u.toString();
}

function decodeJwtEmail(idToken: string): string | null {
  const parts = idToken.split(".");
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf8",
    );
    const claims = JSON.parse(json) as Record<string, unknown>;
    if (claims.email_verified === false) return null;
    const email =
      (claims.email as string) ||
      (claims.preferred_username as string) ||
      (claims.upn as string) ||
      null;
    if (!email || typeof email !== "string" || !email.includes("@")) return null;
    return email.trim().toLowerCase();
  } catch {
    return null;
  }
}

/** Exchange an auth code for tokens and return the verified email, or null. */
export async function exchangeCodeForEmail(
  p: Provider,
  code: string,
  redirect: string,
): Promise<string | null> {
  const cfg = providerConfig(p);
  if (!cfg) return null;
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
    redirect_uri: redirect,
    grant_type: "authorization_code",
  });
  let res: Response;
  try {
    res = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body,
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const tokens = (await res.json().catch(() => null)) as { id_token?: string } | null;
  if (!tokens?.id_token) return null;
  return decodeJwtEmail(tokens.id_token);
}
