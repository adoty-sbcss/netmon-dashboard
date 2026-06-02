"use server";

/**
 * Inventory remediation actions. The headline one: add an SNMP community string
 * to every sensor at a school so the sensor trials it on its next scan and
 * unlocks any reachable-but-silent device it fits. No collector change needed —
 * checkin.py already maps desiredConfig.snmp_communities → NETMON_SNMP_COMMUNITIES.
 */
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { sensors, auditLog } from "@/db/schema/app";
import { desiredConfig } from "@/db/schema/management";
import { getSessionUser } from "@/lib/auth/current-user";

export interface InventoryActionState {
  error?: string;
  ok?: boolean;
  message?: string;
}

async function requireAdmin() {
  const user = await getSessionUser();
  return user?.role === "superadmin" ? user : null;
}

function mergeCommunities(existing: unknown, add: string): string {
  const cur = String(existing ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!cur.some((c) => c.toLowerCase() === add.toLowerCase())) cur.push(add);
  return cur.join(",");
}

/** Append an SNMP community to every sensor at the school's desired config. */
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

  const schoolSensors = await db
    .select({ id: sensors.id, slug: sensors.slug })
    .from(sensors)
    .where(eq(sensors.schoolId, schoolId));
  if (schoolSensors.length === 0)
    return { error: "No sensors at this school to receive the community." };

  for (const sensor of schoolSensors) {
    const [existing] = await db
      .select()
      .from(desiredConfig)
      .where(eq(desiredConfig.sensorId, sensor.id));
    const curConfig = (existing?.config as Record<string, unknown>) ?? {};
    const nextConfig = {
      ...curConfig,
      snmp_enabled: true,
      snmp_communities: mergeCommunities(curConfig.snmp_communities, community),
    };
    const nextVersion = (existing?.configVersion ?? 0) + 1;
    await db
      .insert(desiredConfig)
      .values({
        sensorId: sensor.id,
        configVersion: nextVersion,
        config: nextConfig,
        updatedBy: admin.id,
      })
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
