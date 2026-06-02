/**
 * Push the SNMP community strings entered in the equipment registry down to the
 * school's sensors, so the sensor trials them on its next scan.
 *
 * SAFE-MERGE: the pushed community list is the UNION of
 *   (the box's currently-reported communities) ∪ (current desired config) ∪
 *   (registry communities)
 * so a push never wipes the install-time strings the box already has. We also
 * skip the write entirely when nothing changed, to avoid pointless config-version
 * bumps (which make the sensor restart to re-apply).
 */
import "server-only";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { registryDevices } from "@/db/schema";
import { sensors } from "@/db/schema/app";
import { desiredConfig } from "@/db/schema/management";
import { decryptSecret } from "@/lib/crypto/secret-box";

function toList(s: string | null | undefined): string[] {
  return String(s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Case-insensitive dedup-merge of several comma lists into one string. */
export function mergeCommunityLists(...lists: string[][]): string {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const l of lists) {
    for (const c of l) {
      const k = c.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(c);
      }
    }
  }
  return out.join(",");
}

export interface SyncResult {
  communities: number;
  sensorsTotal: number;
  sensorsUpdated: number;
}

export async function syncRegistryCommunitiesToSensors(
  schoolId: number,
): Promise<SyncResult> {
  // Distinct SNMP communities entered for this school's registry devices.
  const rows = await db
    .select({ enc: registryDevices.snmpCommunityEnc })
    .from(registryDevices)
    .where(
      and(eq(registryDevices.schoolId, schoolId), eq(registryDevices.monitorType, "snmp")),
    );
  const registryComms: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.enc) continue;
    try {
      const c = decryptSecret(r.enc).trim();
      const k = c.toLowerCase();
      if (c && !seen.has(k)) {
        seen.add(k);
        registryComms.push(c);
      }
    } catch {
      // skip undecryptable
    }
  }
  if (registryComms.length === 0) {
    return { communities: 0, sensorsTotal: 0, sensorsUpdated: 0 };
  }

  const schoolSensors = await db.select().from(sensors).where(eq(sensors.schoolId, schoolId));
  let updated = 0;
  for (const sensor of schoolSensors) {
    const [existing] = await db
      .select()
      .from(desiredConfig)
      .where(eq(desiredConfig.sensorId, sensor.id));
    const curConfig = (existing?.config as Record<string, unknown>) ?? {};
    const curStr = String(curConfig.snmp_communities ?? "");
    const merged = mergeCommunityLists(
      toList(sensor.reportedSnmpCommunities), // what the box actually runs now
      toList(curStr), // what we've already pushed
      registryComms, // what the registry wants
    );
    const enabledOk = curConfig.snmp_enabled === true;
    if (existing && merged === curStr && enabledOk) continue; // no change

    const nextConfig = { ...curConfig, snmp_enabled: true, snmp_communities: merged };
    const nextVersion = (existing?.configVersion ?? 0) + 1;
    await db
      .insert(desiredConfig)
      .values({ sensorId: sensor.id, configVersion: nextVersion, config: nextConfig })
      .onConflictDoUpdate({
        target: desiredConfig.sensorId,
        set: { configVersion: nextVersion, config: nextConfig, updatedAt: new Date() },
      });
    updated++;
  }
  return { communities: registryComms.length, sensorsTotal: schoolSensors.length, sensorsUpdated: updated };
}
