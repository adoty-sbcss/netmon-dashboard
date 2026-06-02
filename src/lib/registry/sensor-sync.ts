/**
 * Push registry SNMP intent down to a school's sensors: the community strings
 * AND the explicit target IPs of devices the operator marked monitor=SNMP, so
 * the sensor polls them even if its OUI/heuristics wouldn't flag them as gear.
 *
 * SAFE: communities are the UNION of (box-reported ∪ current desired ∪ registry)
 * so a push never wipes the box's install-time strings. Target IPs are
 * dashboard-owned, so they're replaced with the current registry set. We skip
 * the write when nothing changed (no needless config-version bump / restart).
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
  targets: number;
  sensorsTotal: number;
  sensorsUpdated: number;
}

export async function syncRegistryCommunitiesToSensors(
  schoolId: number,
): Promise<SyncResult> {
  // SNMP-marked registry devices for this school: their communities + IPs.
  const rows = await db
    .select({ enc: registryDevices.snmpCommunityEnc, ip: registryDevices.ip })
    .from(registryDevices)
    .where(
      and(eq(registryDevices.schoolId, schoolId), eq(registryDevices.monitorType, "snmp")),
    );

  const registryComms: string[] = [];
  const commSeen = new Set<string>();
  const registryIps: string[] = [];
  const ipSeen = new Set<string>();
  for (const r of rows) {
    if (r.enc) {
      try {
        const c = decryptSecret(r.enc).trim();
        const k = c.toLowerCase();
        if (c && !commSeen.has(k)) {
          commSeen.add(k);
          registryComms.push(c);
        }
      } catch {
        // skip undecryptable
      }
    }
    if (r.ip) {
      const ip = r.ip.trim();
      if (ip && !ipSeen.has(ip)) {
        ipSeen.add(ip);
        registryIps.push(ip);
      }
    }
  }
  if (registryComms.length === 0 && registryIps.length === 0) {
    return { communities: 0, targets: 0, sensorsTotal: 0, sensorsUpdated: 0 };
  }

  const targetsStr = registryIps.join(",");
  const schoolSensors = await db.select().from(sensors).where(eq(sensors.schoolId, schoolId));
  let updated = 0;
  for (const sensor of schoolSensors) {
    const [existing] = await db
      .select()
      .from(desiredConfig)
      .where(eq(desiredConfig.sensorId, sensor.id));
    const curConfig = (existing?.config as Record<string, unknown>) ?? {};
    const curComm = String(curConfig.snmp_communities ?? "");
    const curTargets = String(curConfig.snmp_targets ?? "");
    const merged = mergeCommunityLists(
      toList(sensor.reportedSnmpCommunities),
      toList(curComm),
      registryComms,
    );
    const enabledOk = curConfig.snmp_enabled === true;
    if (existing && merged === curComm && targetsStr === curTargets && enabledOk) continue;

    const nextConfig = {
      ...curConfig,
      snmp_enabled: true,
      snmp_communities: merged,
      snmp_targets: targetsStr,
    };
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
  return {
    communities: registryComms.length,
    targets: registryIps.length,
    sensorsTotal: schoolSensors.length,
    sensorsUpdated: updated,
  };
}
