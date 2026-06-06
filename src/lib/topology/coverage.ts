/**
 * Map COVERAGE model — which Layer-2 segments at a school actually have a sensor
 * collecting (ARP/DHCP/mDNS + local FDB) vs. are only seen "up the spine."
 *
 * A sensor only enumerates endpoints on its OWN subnet (scan_runs.interface_cidr).
 * A switch reached up the spine is visible, but the devices behind it are NOT
 * collected unless a sensor lives on its L2. This model surfaces that blind spot so
 * the map can say "you're missing a sensor here" and the AI can recommend where to
 * deploy one. Computed entirely from existing tables — no new collection.
 */
import "server-only";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { scanRuns, sensors, entitiesHost, entitiesSwitch } from "@/db/schema";
import { ipInAnyCidr, ipInCidr, normalizeCidr, slash24 } from "@/lib/net";

export interface BlindSubnet {
  subnet: string; // "/24" bucket, e.g. "10.4.20.0/24"
  deviceCount: number; // discovered hosts seen in it (collected elsewhere / via FDB)
  servingSwitch: string | null; // best-effort: the switch whose mgmt IP is in it
}

export interface CoverageSummary {
  sensorCount: number;
  /** Normalized subnets a sensor sweeps L2 on (for the map overlay). */
  coveredCidrs: string[];
  coveredSubnetCount: number;
  observedSubnetCount: number;
  /** Subnets with devices but no sensor, biggest first. */
  blindSubnets: BlindSubnet[];
}

const netIp = (bucket: string) => bucket.split("/")[0];

export async function getCoverageForSchool(schoolId: number): Promise<CoverageSummary> {
  const [scanRows, hosts, switches] = await Promise.all([
    db
      .select({ sensorId: scanRuns.sensorId, id: scanRuns.id, cidr: scanRuns.interfaceCidr })
      .from(scanRuns)
      .innerJoin(sensors, eq(scanRuns.sensorId, sensors.id))
      .where(eq(sensors.schoolId, schoolId)),
    db
      .select({ ip: entitiesHost.ip })
      .from(entitiesHost)
      .where(and(eq(entitiesHost.schoolId, schoolId), isNull(entitiesHost.excludedAt))),
    db
      .select({ mgmtIp: entitiesSwitch.mgmtIp, name: entitiesSwitch.systemName, chassisId: entitiesSwitch.chassisId })
      .from(entitiesSwitch)
      .where(and(eq(entitiesSwitch.schoolId, schoolId), isNull(entitiesSwitch.excludedAt))),
  ]);

  // Latest interface_cidr per sensor = the L2 segments we actually collect on.
  const latestPerSensor = new Map<number, { id: number; cidr: string | null }>();
  for (const r of scanRows) {
    const sid = r.sensorId ?? -1;
    const cur = latestPerSensor.get(sid);
    if (!cur || r.id > cur.id) latestPerSensor.set(sid, { id: r.id, cidr: r.cidr });
  }
  const coveredCidrs = [
    ...new Set(
      [...latestPerSensor.values()]
        .map((v) => normalizeCidr(v.cidr))
        .filter((c): c is string => c != null),
    ),
  ];
  const sensorCount = latestPerSensor.size;

  // Observed /24 buckets, with host device counts.
  const deviceCount = new Map<string, number>();
  for (const h of hosts) {
    const b = slash24(h.ip);
    if (b) deviceCount.set(b, (deviceCount.get(b) ?? 0) + 1);
  }
  // Switches contribute their mgmt subnet to the observed set even if no host lives there.
  const observed = new Set<string>(deviceCount.keys());
  for (const s of switches) {
    const b = slash24(s.mgmtIp);
    if (b) observed.add(b);
  }

  let coveredSubnetCount = 0;
  const blindSubnets: BlindSubnet[] = [];
  for (const bucket of observed) {
    if (ipInAnyCidr(netIp(bucket), coveredCidrs)) {
      coveredSubnetCount++;
      continue;
    }
    const serving = switches.find((s) => s.mgmtIp && ipInCidr(s.mgmtIp, bucket));
    blindSubnets.push({
      subnet: bucket,
      deviceCount: deviceCount.get(bucket) ?? 0,
      servingSwitch: serving ? serving.name || serving.mgmtIp || serving.chassisId : null,
    });
  }
  blindSubnets.sort((a, b) => b.deviceCount - a.deviceCount);

  return {
    sensorCount,
    coveredCidrs,
    coveredSubnetCount,
    observedSubnetCount: observed.size,
    blindSubnets,
  };
}
