/**
 * Read/write the per-district authorized DHCP server list. Used to (a) annotate
 * the DHCP page and (b) tell the AI which servers are expected, so authorized
 * servers don't surface as rogue/critical alerts.
 */
import "server-only";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { dhcpAuthorizedServers } from "@/db/schema/policy";

export interface AuthorizedDhcpServer {
  id: number;
  serverIp: string;
  label: string | null;
  note: string | null;
  createdAt: Date;
}

export async function listAuthorizedDhcpServers(
  districtId: number,
): Promise<AuthorizedDhcpServer[]> {
  return db
    .select({
      id: dhcpAuthorizedServers.id,
      serverIp: dhcpAuthorizedServers.serverIp,
      label: dhcpAuthorizedServers.label,
      note: dhcpAuthorizedServers.note,
      createdAt: dhcpAuthorizedServers.createdAt,
    })
    .from(dhcpAuthorizedServers)
    .where(eq(dhcpAuthorizedServers.districtId, districtId))
    .orderBy(dhcpAuthorizedServers.serverIp);
}

/** Set of authorized server IPs for fast membership checks. */
export async function getAuthorizedDhcpServerSet(
  districtId: number,
): Promise<Set<string>> {
  const rows = await db
    .select({ ip: dhcpAuthorizedServers.serverIp })
    .from(dhcpAuthorizedServers)
    .where(eq(dhcpAuthorizedServers.districtId, districtId));
  return new Set(rows.map((r) => r.ip));
}

export async function addAuthorizedDhcpServer(input: {
  districtId: number;
  serverIp: string;
  label?: string | null;
  note?: string | null;
  addedBy?: number | null;
}): Promise<void> {
  await db
    .insert(dhcpAuthorizedServers)
    .values({
      districtId: input.districtId,
      serverIp: input.serverIp,
      label: input.label ?? null,
      note: input.note ?? null,
      addedBy: input.addedBy ?? null,
    })
    .onConflictDoUpdate({
      target: [dhcpAuthorizedServers.districtId, dhcpAuthorizedServers.serverIp],
      set: { label: input.label ?? null, note: input.note ?? null },
    });
}

/** Remove by row id, scoped to the district (defense in depth). */
export async function removeAuthorizedDhcpServer(
  id: number,
  districtId: number,
): Promise<void> {
  await db
    .delete(dhcpAuthorizedServers)
    .where(
      and(
        eq(dhcpAuthorizedServers.id, id),
        eq(dhcpAuthorizedServers.districtId, districtId),
      ),
    );
}
