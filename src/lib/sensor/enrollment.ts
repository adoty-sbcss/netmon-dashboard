/**
 * Sensor auto-enrollment via a shared bootstrap key.
 *
 * A new box carries one shared passphrase (NETMON_BOOTSTRAP_KEY) — baked into
 * setup, not per-sensor. On its first check-in it presents the key + its identity
 * slugs; the dashboard verifies the key, get-or-creates the sensor, and issues a
 * unique per-sensor token the box keeps. Techs never copy a token.
 *
 * The bootstrap key is stored encrypted (AES-256-GCM) on the singleton
 * ingest_settings row so an admin can view it to distribute it.
 */
import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { ingestSettings } from "@/db/schema/app";
import { encryptSecret, decryptSecret } from "@/lib/crypto/secret-box";

const SINGLETON_ID = 1;

export interface EnrollmentView {
  autoEnrollEnabled: boolean;
  /** Decrypted key for the admin to copy onto boxes (page is superadmin-only). */
  bootstrapKey: string | null;
}

export async function getEnrollmentView(): Promise<EnrollmentView> {
  const [row] = await db
    .select({
      autoEnrollEnabled: ingestSettings.autoEnrollEnabled,
      bootstrapKeyEnc: ingestSettings.bootstrapKeyEnc,
    })
    .from(ingestSettings)
    .where(eq(ingestSettings.id, SINGLETON_ID))
    .limit(1);
  let bootstrapKey: string | null = null;
  if (row?.bootstrapKeyEnc) {
    try {
      bootstrapKey = decryptSecret(row.bootstrapKeyEnc);
    } catch {
      bootstrapKey = null;
    }
  }
  return { autoEnrollEnabled: row?.autoEnrollEnabled ?? false, bootstrapKey };
}

export interface SaveEnrollmentInput {
  autoEnrollEnabled: boolean;
  /** Set a new key. If `generate`, a strong random key is created instead. */
  newBootstrapKey?: string;
  generate?: boolean;
  updatedBy: number;
}

export async function saveEnrollment(input: SaveEnrollmentInput): Promise<void> {
  const set: Partial<typeof ingestSettings.$inferInsert> = {
    autoEnrollEnabled: input.autoEnrollEnabled,
    updatedBy: input.updatedBy,
    updatedAt: new Date(),
  };
  if (input.generate) {
    set.bootstrapKeyEnc = encryptSecret(`nmk_${randomBytes(18).toString("base64url")}`);
  } else if (input.newBootstrapKey) {
    set.bootstrapKeyEnc = encryptSecret(input.newBootstrapKey);
  }
  await db
    .insert(ingestSettings)
    .values({ id: SINGLETON_ID, ...set })
    .onConflictDoUpdate({ target: ingestSettings.id, set });
}

/** Verify a presented bootstrap key (constant-time). */
export async function verifyBootstrap(presented: string): Promise<boolean> {
  if (!presented) return false;
  const [row] = await db
    .select({
      autoEnrollEnabled: ingestSettings.autoEnrollEnabled,
      bootstrapKeyEnc: ingestSettings.bootstrapKeyEnc,
    })
    .from(ingestSettings)
    .where(eq(ingestSettings.id, SINGLETON_ID))
    .limit(1);
  if (!row?.autoEnrollEnabled || !row.bootstrapKeyEnc) return false;
  let stored: string;
  try {
    stored = decryptSecret(row.bootstrapKeyEnc);
  } catch {
    return false;
  }
  const a = Buffer.from(stored, "utf8");
  const b = Buffer.from(presented, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
