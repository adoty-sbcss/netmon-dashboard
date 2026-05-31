/**
 * Symmetric encryption for secrets stored at rest in the DB (the SFTP password /
 * private key / passphrase in `ingest_settings`). AES-256-GCM via Node's crypto.
 *
 * The key is derived from AUTH_SECRET — the same Key Vault secret that signs
 * sessions — with scrypt + a fixed application salt. AUTH_SECRET already lives
 * only in Key Vault + the container env, never in the repo, so a leak of the DB
 * alone does NOT expose the SFTP credentials.
 *
 * Ciphertext format (compact, self-describing):
 *   v1.<iv b64url>.<tag b64url>.<ciphertext b64url>
 * The version prefix lets us rotate the scheme later without ambiguity.
 *
 * Node runtime only (uses node:crypto). Imported by the settings module, the
 * web server actions, and the CLI sync — all of which run under Node/tsx.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

const VERSION = "v1";
const ALGO = "aes-256-gcm";
const IV_LEN = 12; // 96-bit nonce, standard for GCM
const KEY_LEN = 32; // AES-256
// Fixed, non-secret application salt — domain-separates this key from any other
// use of AUTH_SECRET (e.g. the HMAC session key in lib/auth/session.ts).
const SALT = Buffer.from("netmon.ingest.secret-box.v1");

let cachedKey: Buffer | null = null;
function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  cachedKey = scryptSync(secret, SALT, KEY_LEN, { N: 16384, r: 8, p: 1 });
  return cachedKey;
}

const b64url = (b: Buffer): string =>
  b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/** Encrypt a plaintext secret. Returns the compact ciphertext string. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}.${b64url(iv)}.${b64url(tag)}.${b64url(ct)}`;
}

/**
 * Decrypt a ciphertext produced by encryptSecret. Throws if the AUTH_SECRET is
 * wrong, the data was tampered with, or the format is unrecognized.
 */
export function decryptSecret(token: string): string {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Unrecognized secret ciphertext format");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = createDecipheriv(ALGO, getKey(), fromB64url(ivB64));
  decipher.setAuthTag(fromB64url(tagB64));
  const pt = Buffer.concat([decipher.update(fromB64url(ctB64)), decipher.final()]);
  return pt.toString("utf8");
}
