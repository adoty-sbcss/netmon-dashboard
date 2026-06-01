/**
 * Per-district network policy — operator-declared "this is expected" lists that
 * suppress false alarms. First entry: authorized DHCP servers, so a known server
 * isn't reported as a rogue/critical alert (on the DHCP page or in AI reports);
 * only servers NOT on the list are flagged.
 */
import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { districts, users } from "./app";

export const dhcpAuthorizedServers = pgTable(
  "dhcp_authorized_servers",
  {
    id: serial("id").primaryKey(),
    districtId: integer("district_id")
      .notNull()
      .references(() => districts.id, { onDelete: "cascade" }),
    /** The DHCP server IP that is expected/authorized in this district. */
    serverIp: text("server_ip").notNull(),
    /** Optional human label, e.g. "Core DHCP — district office". */
    label: text("label"),
    note: text("note"),
    addedBy: integer("added_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("uq_dhcp_authz_district_ip").on(t.districtId, t.serverIp),
    index("idx_dhcp_authz_district").on(t.districtId),
  ],
);
