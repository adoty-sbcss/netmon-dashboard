/**
 * Local-account password hashing using Node's built-in scrypt — no native or
 * third-party crypto dependency (keeps the Azure build simple). Only used for
 * break-glass / local accounts; federated (OIDC) users never have a password.
 *
 * Node-only (uses node:crypto). Do NOT import from edge middleware.
 *
 * Stored format:  scrypt$N$r$p$<saltHex>$<hashHex>
 */
import "server-only";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// Cost params: N=16384 keeps verify well under ~100ms on App Service tiers.
const N = 16384;
const r = 8;
const p = 1;
const KEYLEN = 64;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, { N, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/** Hash a plaintext password into a self-describing, storable string. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${key.toString("hex")}`;
}

/** Constant-time verify a plaintext password against a stored hash. */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, , , , saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  let actual: Buffer;
  try {
    actual = await scryptAsync(password, salt);
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
