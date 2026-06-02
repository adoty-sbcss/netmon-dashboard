"use server";

/**
 * Inventory remediation actions:
 *  - addSnmpCommunityAction: add one community to the school's sensors.
 *  - syncRegistryToSensorAction: push every registry SNMP community to the
 *    school's sensors on demand.
 *
 * Both MERGE with the box's reported communities (never clobber install-time
 * strings). No collector change needed — checkin.py maps
 * desiredConfig.snmp_communities → NETMON_SNMP_COMMUNITIES.
 */
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { sensors, auditLog } from "@/db/schema/app";
import { desiredConfig } from "@/db/schema/management";
import { getSessionUser } from "@/lib/auth/current-user";
import {
  syncRegistryCommunitiesToSensors,
  mergeCommunityLists,
} from "@/lib/registry/sensor-sync";

export interface InventoryActionState {
  error?: string;
  ok?: boolean;
  message?: string;
}

async function requireAdmin() {
  const user = await getSessionUser();
  return user?.role === "superadmin" ? user : null;
}

function toList(s: unknown): string[] {
  return String(s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Append an SNMP community to every sensor at the school (merging, not clobbering). */
export async function addSnmpCommunityAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };

  const schoolId = Number(formData.get("schoolId"));
  const community = String(formData.get("community") ?? "").trim();
  const basePath = String(formData.get("basePath") ?? "");
  if (!Number.isInteger(schoolId)) return { error: "Invalid school." };
  if (!community) return { error: "Enter a community string." };
  if (community.length > 64) return { error: "That community string looks too long." };

  const schoolSensors = await db.select().from(sensors).where(eq(sensors.schoolId, schoolId));
  if (schoolSensors.length === 0)
    return { error: "No sensors at this school to receive the community." };

  for (const sensor of schoolSensors) {
    const [existing] = await db
      .select()
      .from(desiredConfig)
      .where(eq(desiredConfig.sensorId, sensor.id));
    const curConfig = (existing?.config as Record<string, unknown>) ?? {};
    const merged = mergeCommunityLists(
      toList(sensor.reportedSnmpCommunities),
      toList(curConfig.snmp_communities),
      [community],
    );
    const nextConfig = { ...curConfig, snmp_enabled: true, snmp_communities: merged };
    const nextVersion = (existing?.configVersion ?? 0) + 1;
    await db
      .insert(desiredConfig)
      .values({ sensorId: sensor.id, configVersion: nextVersion, config: nextConfig, updatedBy: admin.id })
      .onConflictDoUpdate({
        target: desiredConfig.sensorId,
        set: { configVersion: nextVersion, config: nextConfig, updatedBy: admin.id, updatedAt: new Date() },
      });
  }

  await db.insert(auditLog).values({
    actorType: "user",
    actor: admin.email,
    action: "snmp_community_added",
    detail: { schoolId, sensors: schoolSensors.length },
  });
  revalidatePath(basePath);
  revalidatePath(`${basePath}/inventory`);
  return {
    ok: true,
    message: `Community added to ${schoolSensors.length} sensor(s). It'll be tried on the next scan; devices it unlocks will start reporting SNMP.`,
  };
}

/** Push all registry SNMP communities for the school to its sensors on demand. */
export async function syncRegistryToSensorAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };
  const schoolId = Number(formData.get("schoolId"));
  const basePath = String(formData.get("basePath") ?? "");
  if (!Number.isInteger(schoolId)) return { error: "Invalid school." };

  const res = await syncRegistryCommunitiesToSensors(schoolId);
  await db.insert(auditLog).values({
    actorType: "user",
    actor: admin.email,
    action: "registry_snmp_sync",
    detail: { schoolId, ...res },
  });
  revalidatePath(`${basePath}/inventory`);

  if (res.communities === 0)
    return { ok: true, message: "No registry devices have an SNMP community to push." };
  return {
    ok: true,
    message: `Pushed ${res.communities} community string(s) to ${res.sensorsUpdated} of ${res.sensorsTotal} sensor(s). They'll be tried on the next scan.`,
  };
}
