/**
 * One-shot backfill: re-derive manufacturer + device type (and fill missing
 * hostnames) for every existing canonical host (entities_host), using the OUI
 * registry + classifier + the DHCP fingerprint captured in dhcp_observations.
 * Idempotent — safe to run repeatedly. New ingests enrich inline; this catches
 * rows ingested before the logic existed.
 *
 *   npm run enrich
 *
 * Required env: DATABASE_URL. Runs under tsx in the migrator/ingest image.
 */
import "dotenv/config";

import { desc, eq, isNotNull, or } from "drizzle-orm";
import { db } from "../db";
import { entitiesHost } from "../db/schema";
import { dhcpObservations } from "../db/schema/netmon";
import { enrichHost } from "../lib/oui";

interface Fp {
  hostname?: string | null;
  vendorClass?: string | null;
  paramList?: string | null;
}

async function buildDhcpFingerprints(): Promise<Map<string, Fp>> {
  const rows = await db
    .select({
      clientMac: dhcpObservations.clientMac,
      clientHostname: dhcpObservations.clientHostname,
      vendorClassId: dhcpObservations.vendorClassId,
      paramReqList: dhcpObservations.paramReqList,
    })
    .from(dhcpObservations)
    .where(
      or(
        isNotNull(dhcpObservations.clientHostname),
        isNotNull(dhcpObservations.vendorClassId),
      ),
    )
    .orderBy(desc(dhcpObservations.id));

  const fp = new Map<string, Fp>();
  for (const r of rows) {
    const mac = r.clientMac?.toLowerCase();
    if (!mac) continue;
    const cur = fp.get(mac) ?? {};
    if (!cur.hostname && r.clientHostname) cur.hostname = r.clientHostname;
    if (!cur.vendorClass && r.vendorClassId) cur.vendorClass = r.vendorClassId;
    if (!cur.paramList && r.paramReqList) cur.paramList = r.paramReqList;
    fp.set(mac, cur);
  }
  return fp;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

  const dhcpFp = await buildDhcpFingerprints();

  const rows = await db
    .select({
      id: entitiesHost.id,
      mac: entitiesHost.mac,
      vendor: entitiesHost.vendor,
      hostname: entitiesHost.hostname,
      deviceType: entitiesHost.deviceType,
    })
    .from(entitiesHost);

  let changed = 0;
  for (const r of rows) {
    const fp = dhcpFp.get(r.mac.toLowerCase());
    const hostname = r.hostname ?? fp?.hostname ?? null;
    const { vendor, deviceType } = enrichHost({
      mac: r.mac,
      vendor: r.vendor,
      hostname,
      dhcpVendorClass: fp?.vendorClass ?? null,
      dhcpParamList: fp?.paramList ?? null,
    });
    if (vendor !== r.vendor || deviceType !== r.deviceType || hostname !== r.hostname) {
      await db
        .update(entitiesHost)
        .set({ vendor, deviceType, hostname, updatedAt: new Date() })
        .where(eq(entitiesHost.id, r.id));
      changed++;
    }
  }

  console.log(
    `Enrichment backfill complete: ${changed} of ${rows.length} host(s) updated ` +
      `(${dhcpFp.size} DHCP fingerprints available).`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Enrich failed:", err);
  process.exit(1);
});
