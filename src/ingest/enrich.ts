/**
 * One-shot backfill: re-derive manufacturer + device type for every existing
 * canonical host (entities_host) using the OUI table + classifier. Idempotent —
 * safe to run repeatedly. New ingests enrich inline; this catches rows that were
 * ingested before enrichment existed.
 *
 *   npm run enrich
 *
 * Required env: DATABASE_URL. Runs under tsx in the migrator/ingest image.
 */
import "dotenv/config";

import { eq } from "drizzle-orm";
import { db } from "../db";
import { entitiesHost } from "../db/schema";
import { enrichHost } from "../lib/oui";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

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
    const { vendor, deviceType } = enrichHost({
      mac: r.mac,
      vendor: r.vendor,
      hostname: r.hostname,
    });
    if (vendor !== r.vendor || deviceType !== r.deviceType) {
      await db
        .update(entitiesHost)
        .set({ vendor, deviceType, updatedAt: new Date() })
        .where(eq(entitiesHost.id, r.id));
      changed++;
    }
  }

  console.log(
    `Enrichment backfill complete: ${changed} of ${rows.length} host(s) updated.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Enrich failed:", err);
  process.exit(1);
});
