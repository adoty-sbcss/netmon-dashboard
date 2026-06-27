/**
 * Stateless session token: a compact `<payloadB64url>.<sigB64url>` string signed
 * with HMAC-SHA256 over AUTH_SECRET. Implemented with Web Crypto (globalThis.crypto)
 * so it runs in BOTH the Edge middleware and the Node server-action runtime.
 *
 * The token carries only what the middleware needs to gate routes without a DB
 * hit: the user id, a "must change password" flag, and an expiry. Full user
 * loading + authorization happens server-side (see current-user.ts).
 */

export const SESSION_COOKIE = "nm_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12h

export interface SessionClaims {
  /** users.id */
  uid: number;
  /** must change password before using the app */
  pwc: boolean;
  /** read-only (viewer) session — the Edge middleware blocks every mutation for it.
   *  Carried in the token so the middleware can enforce without a DB hit. */
  ro?: boolean;
  /** expiry, epoch seconds */
  exp: number;
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Copy into a fresh ArrayBuffer so Web Crypto's BufferSource typing is satisfied. */
function ab(data: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(data.byteLength);
  new Uint8Array(out).set(data);
  return out;
}

const utf8 = (s: string): ArrayBuffer => ab(new TextEncoder().encode(s));

let keyPromise: Promise<CryptoKey> | null = null;
function getKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    const secret = process.env.AUTH_SECRET;
    if (!secret) throw new Error("AUTH_SECRET is not set");
    keyPromise = crypto.subtle.importKey(
      "raw",
      utf8(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  }
  return keyPromise;
}

/** Create a signed session token for a user. */
export async function createSessionToken(
  uid: number,
  opts: { mustChangePassword?: boolean; readOnly?: boolean; ttlSeconds?: number } = {},
): Promise<string> {
  const exp =
    Math.floor(Date.now() / 1000) + (opts.ttlSeconds ?? SESSION_TTL_SECONDS);
  const claims: SessionClaims = { uid, pwc: !!opts.mustChangePassword, ro: !!opts.readOnly, exp };
  const payload = b64urlEncode(new TextEncoder().encode(JSON.stringify(claims)));
  const key = await getKey();
  const sig = await crypto.subtle.sign("HMAC", key, utf8(payload));
  return `${payload}.${b64urlEncode(new Uint8Array(sig))}`;
}

/** Verify a token's signature + expiry; return claims or null. */
export async function verifySessionToken(
  token: string | undefined | null,
): Promise<SessionClaims | null> {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let ok = false;
  try {
    const key = await getKey();
    ok = await crypto.subtle.verify("HMAC", key, ab(b64urlDecode(sig)), utf8(payload));
  } catch {
    return null;
  }
  if (!ok) return null;
  let claims: SessionClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(b64urlDecode(payload)));
  } catch {
    return null;
  }
  if (
    typeof claims.uid !== "number" ||
    typeof claims.exp !== "number" ||
    claims.exp < Math.floor(Date.now() / 1000)
  ) {
    return null;
  }
  return claims;
}
