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
import { classifyHost } from "../lib/classify";

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
      classConfidence: entitiesHost.classConfidence,
      attributes: entitiesHost.attributes,
    })
    .from(entitiesHost);

  let changed = 0;
  for (const r of rows) {
    const fp = dhcpFp.get(r.mac.toLowerCase());
    const hostname = r.hostname ?? fp?.hostname ?? null;
    // mDNS hint + gateway flag were persisted on attributes at ingest — reuse them
    // so the backfill classifies with the same signals (no scan context here).
    const attrs = (r.attributes && typeof r.attributes === "object" ? r.attributes : {}) as Record<string, unknown>;
    const serviceHint = typeof attrs.service_hint === "string" ? attrs.service_hint : null;
    const services = Array.isArray(attrs.services) ? attrs.services.map(String) : null;
    const cls = classifyHost({
      mac: r.mac,
      vendor: r.vendor,
      hostname,
      dhcpVendorClass: fp?.vendorClass ?? null,
      dhcpParamList: fp?.paramList ?? null,
      serviceHint,
      services,
      isGateway: attrs.gateway === true,
    });
    // Re-write when vendor/type/hostname changed OR the scored fields were never
    // populated (rows ingested before the scored-classification columns existed).
    if (
      cls.vendor !== r.vendor ||
      cls.deviceType !== r.deviceType ||
      hostname !== r.hostname ||
      r.classConfidence == null
    ) {
      await db
        .update(entitiesHost)
        .set({
          vendor: cls.vendor,
          deviceType: cls.deviceType,
          hostname,
          classConfidence: cls.confidence,
          classMethod: cls.method,
          classSources: cls.sources,
          classSignalHash: cls.signalHash,
          updatedAt: new Date(),
        })
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
