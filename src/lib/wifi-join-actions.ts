"use server";

/**
 * WIFI-6: Wi-Fi join configuration portal actions (school-scoped profiles + the
 * per-sensor push). An admin defines SSID/auth/captive profiles for a SCHOOL; each
 * profile's credential is SHARED (one key for the school) or PER_SENSOR (each
 * sensor its own key — MPSK, 1 MAC = 1 PSK). Sensors opt in per profile.
 *
 * The push is DERIVED: whenever a profile or an assignment changes, we rebuild the
 * affected sensor's `wifi_join_profiles` list (resolving secrets) into its
 * desired_config + set the `wifi_join_enabled` gate, and bump the version. The
 * collector writes it to a 0600 file and the host battery loops it (join -> measure
 * -> leave, routes-off). "Test now" queues the `host-wifi-experience` host action.
 *
 * Secrets are stored ENCRYPTED at rest (secret-box, like districtSftp.passwordEnc)
 * and only decrypted here to materialize the push. Superadmin-only. Self-contained.
 */
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { auditLog } from "@/db/schema/app";
import {
  commandQueue,
  desiredConfig,
  wifiNetworkProfiles,
  wifiProfileSensors,
} from "@/db/schema/management";
import { getSessionUser } from "@/lib/auth/current-user";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-box";

export interface WifiActionState {
  ok?: boolean;
  error?: string;
  message?: string;
}

async function audit(actor: string, action: string, detail: Record<string, unknown> = {}) {
  await db.insert(auditLog).values({ actorType: "user", actor, action, detail }).catch(() => {});
}

async function requireSuperadmin() {
  const u = await getSessionUser();
  return u && u.role === "superadmin" ? u : null;
}

const AUTHS = new Set(["open", "psk", "peap"]);
const normAuth = (s: string) => (AUTHS.has(s) ? s : "open");
const checked = (v: FormDataEntryValue | null) => v === "on" || v === "true" || v === "1";

/**
 * Rebuild ONE sensor's Wi-Fi join config from the profiles it participates in and
 * push it into desired_config (version bump). Resolves each profile's credential:
 * per_sensor -> the sensor's own row, shared -> the profile's shared secret. The
 * gate `wifi_join_enabled` follows whether any profile remains. Called after every
 * profile/assignment change so the pushed config always matches the tables.
 */
async function syncSensorWifiConfig(sensorId: number, actorId: number): Promise<number> {
  const rows = await db
    .select({
      ssid: wifiNetworkProfiles.ssid,
      auth: wifiNetworkProfiles.authMethod,
      captiveAutoAccept: wifiNetworkProfiles.captiveAutoAccept,
      scope: wifiNetworkProfiles.credentialScope,
      sharedIdentity: wifiNetworkProfiles.sharedIdentity,
      sharedSecretEnc: wifiNetworkProfiles.sharedSecretEnc,
      psIdentity: wifiProfileSensors.identity,
      psSecretEnc: wifiProfileSensors.secretEnc,
    })
    .from(wifiProfileSensors)
    .innerJoin(wifiNetworkProfiles, eq(wifiProfileSensors.profileId, wifiNetworkProfiles.id))
    .where(
      and(
        eq(wifiProfileSensors.sensorId, sensorId),
        eq(wifiProfileSensors.enabled, true),
        eq(wifiNetworkProfiles.enabled, true),
      ),
    );

  const dec = (enc: string | null): string => {
    if (!enc) return "";
    try {
      return decryptSecret(enc);
    } catch {
      return "";
    }
  };
  const profiles = rows.map((r) => {
    const perSensor = r.scope === "per_sensor";
    return {
      ssid: r.ssid,
      auth: r.auth,
      identity: (perSensor ? r.psIdentity : r.sharedIdentity) ?? "",
      secret: dec(perSensor ? r.psSecretEnc : r.sharedSecretEnc),
      captive_auto_accept: r.captiveAutoAccept,
    };
  });

  const [cur] = await db
    .select({ v: desiredConfig.configVersion, config: desiredConfig.config })
    .from(desiredConfig)
    .where(eq(desiredConfig.sensorId, sensorId))
    .limit(1);
  const nextVersion = (cur?.v ?? 0) + 1;
  const config = {
    ...((cur?.config as Record<string, unknown>) ?? {}),
    wifi_join_profiles: profiles,
    wifi_join_enabled: profiles.length > 0,
  };
  await db
    .insert(desiredConfig)
    .values({ sensorId, configVersion: nextVersion, config, updatedBy: actorId })
    .onConflictDoUpdate({
      target: desiredConfig.sensorId,
      set: { configVersion: nextVersion, config, updatedBy: actorId, updatedAt: new Date() },
    });
  return profiles.length;
}

async function sensorIdsForProfile(profileId: number): Promise<number[]> {
  const rows = await db
    .select({ sid: wifiProfileSensors.sensorId })
    .from(wifiProfileSensors)
    .where(eq(wifiProfileSensors.profileId, profileId));
  return rows.map((r) => r.sid);
}

/** Create or update a school-scoped Wi-Fi profile. Blank shared-secret = keep. */
export async function upsertWifiProfileAction(
  _prev: WifiActionState,
  formData: FormData,
): Promise<WifiActionState> {
  const admin = await requireSuperadmin();
  if (!admin) return { error: "Not authorized." };
  const schoolId = Number(formData.get("schoolId"));
  if (!Number.isInteger(schoolId)) return { error: "Invalid school." };
  const profileId = formData.get("profileId") ? Number(formData.get("profileId")) : null;

  const ssid = String(formData.get("ssid") ?? "").trim();
  if (!ssid) return { error: "SSID is required." };
  if (ssid.length > 32) return { error: "SSID must be 32 characters or fewer." };
  const authMethod = normAuth(String(formData.get("authMethod") ?? "open"));
  const captivePortal = checked(formData.get("captivePortal"));
  const captiveAutoAccept = captivePortal && checked(formData.get("captiveAutoAccept"));
  const credentialScope =
    String(formData.get("credentialScope") ?? "shared") === "per_sensor" ? "per_sensor" : "shared";
  const label = String(formData.get("label") ?? "").trim() || null;
  const sharedIdentity = String(formData.get("sharedIdentity") ?? "").trim() || null;
  const isDistrictSsid = formData.has("isDistrictSsid") ? checked(formData.get("isDistrictSsid")) : true;
  const enabled = formData.has("enabled") ? checked(formData.get("enabled")) : true;

  // Shared secret is only (re)written when a value is typed; per_sensor clears it.
  const rawSecret = String(formData.get("sharedSecret") ?? "");
  let sharedSecretEnc: string | null | undefined;
  if (credentialScope === "per_sensor") sharedSecretEnc = null;
  else if (rawSecret) sharedSecretEnc = encryptSecret(rawSecret);

  try {
    let pid = profileId;
    if (profileId) {
      const set: Record<string, unknown> = {
        label,
        ssid,
        authMethod,
        captivePortal,
        captiveAutoAccept,
        credentialScope,
        sharedIdentity,
        isDistrictSsid,
        enabled,
        updatedAt: new Date(),
      };
      if (sharedSecretEnc !== undefined) set.sharedSecretEnc = sharedSecretEnc;
      await db
        .update(wifiNetworkProfiles)
        .set(set)
        .where(and(eq(wifiNetworkProfiles.id, profileId), eq(wifiNetworkProfiles.schoolId, schoolId)));
    } else {
      const [ins] = await db
        .insert(wifiNetworkProfiles)
        .values({
          schoolId,
          label,
          ssid,
          authMethod,
          captivePortal,
          captiveAutoAccept,
          credentialScope,
          sharedIdentity,
          sharedSecretEnc: sharedSecretEnc ?? null,
          isDistrictSsid,
          enabled,
          createdBy: admin.id,
        })
        .returning({ id: wifiNetworkProfiles.id });
      pid = ins.id;
    }
    // Re-materialize config for every sensor on this profile (auth/captive/secret
    // may have changed).
    if (pid) for (const sid of await sensorIdsForProfile(pid)) await syncSensorWifiConfig(sid, admin.id);
    await audit(admin.email, profileId ? "wifi_profile_updated" : "wifi_profile_created", {
      schoolId,
      profileId: pid,
      ssid,
      authMethod,
    });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (/unique|duplicate/i.test(msg)) return { error: `A profile for SSID "${ssid}" already exists at this school.` };
    return { error: "Could not save the profile." };
  }

  revalidatePath(String(formData.get("basePath") ?? "/"));
  return { ok: true, message: `Saved "${ssid}". Participating sensors update on their next check-in.` };
}

/** Delete a profile (cascades its sensor rows); re-sync the sensors it covered. */
export async function deleteWifiProfileAction(
  _prev: WifiActionState,
  formData: FormData,
): Promise<WifiActionState> {
  const admin = await requireSuperadmin();
  if (!admin) return { error: "Not authorized." };
  const profileId = Number(formData.get("profileId"));
  if (!Number.isInteger(profileId)) return { error: "Invalid profile." };

  const sids = await sensorIdsForProfile(profileId);
  await db.delete(wifiNetworkProfiles).where(eq(wifiNetworkProfiles.id, profileId));
  for (const sid of sids) await syncSensorWifiConfig(sid, admin.id); // they lose this network
  await audit(admin.email, "wifi_profile_deleted", { profileId });
  revalidatePath(String(formData.get("basePath") ?? "/"));
  return { ok: true, message: "Profile deleted. Sensors drop it on their next check-in." };
}

/**
 * Assign / update a sensor on a profile (participation toggle + optional per-sensor
 * credential). Blank secret = keep the existing one. Re-materializes that sensor.
 */
export async function setProfileSensorAction(
  _prev: WifiActionState,
  formData: FormData,
): Promise<WifiActionState> {
  const admin = await requireSuperadmin();
  if (!admin) return { error: "Not authorized." };
  const profileId = Number(formData.get("profileId"));
  const sensorId = Number(formData.get("sensorId"));
  if (!Number.isInteger(profileId) || !Number.isInteger(sensorId))
    return { error: "Invalid profile or sensor." };

  const participate = checked(formData.get("participate"));
  const identity = String(formData.get("identity") ?? "").trim() || null;
  const rawSecret = String(formData.get("secret") ?? "");
  const secretEnc = rawSecret ? encryptSecret(rawSecret) : undefined;

  const [existing] = await db
    .select({ id: wifiProfileSensors.id })
    .from(wifiProfileSensors)
    .where(and(eq(wifiProfileSensors.profileId, profileId), eq(wifiProfileSensors.sensorId, sensorId)))
    .limit(1);
  if (existing) {
    const set: Record<string, unknown> = { enabled: participate, identity, updatedAt: new Date() };
    if (secretEnc !== undefined) set.secretEnc = secretEnc;
    await db.update(wifiProfileSensors).set(set).where(eq(wifiProfileSensors.id, existing.id));
  } else {
    await db.insert(wifiProfileSensors).values({
      profileId,
      sensorId,
      enabled: participate,
      identity,
      secretEnc: secretEnc ?? null,
    });
  }
  const n = await syncSensorWifiConfig(sensorId, admin.id);
  await audit(admin.email, "wifi_profile_sensor_set", { profileId, sensorId, participate });
  revalidatePath(String(formData.get("basePath") ?? "/"));
  return {
    ok: true,
    message: participate
      ? `Sensor enrolled (${n} network${n === 1 ? "" : "s"} now pushed). It applies on next check-in.`
      : "Sensor removed from this network. It applies on next check-in.",
  };
}

/**
 * Queue an on-demand Wi-Fi experience battery for a sensor (the "Test now" button,
 * the wireless analog of the wired network test). Syncs the sensor's config first so
 * the battery runs against the latest profiles, then queues host-wifi-experience.
 */
export async function testWifiExperienceAction(
  _prev: WifiActionState,
  formData: FormData,
): Promise<WifiActionState> {
  const admin = await requireSuperadmin();
  if (!admin) return { error: "Not authorized." };
  const sensorId = Number(formData.get("sensorId"));
  if (!Number.isInteger(sensorId)) return { error: "Invalid sensor." };

  const n = await syncSensorWifiConfig(sensorId, admin.id);
  if (n === 0)
    return { error: "This sensor has no enabled networks to test. Enroll it on a profile first." };
  await db.insert(commandQueue).values({
    sensorId,
    command: "host-wifi-experience",
    status: "pending",
    requiresApproval: false,
    createdBy: admin.id,
  });
  await audit(admin.email, "wifi_experience_queued", { sensorId, networks: n });
  revalidatePath(String(formData.get("basePath") ?? "/"));
  return {
    ok: true,
    message: `Queued a Wi-Fi test of ${n} network${n === 1 ? "" : "s"} — results appear after the sensor's next check-in (~3 min).`,
  };
}
