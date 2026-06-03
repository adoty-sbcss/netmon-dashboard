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
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { districts, schools, users } from "./app";

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

/**
 * Per-school operational policy. First field: a master SNMP-crawl switch. When
 * `snmpEnabled` is false the dashboard pushes `snmp_enabled=false` to every
 * sensor at the school, so an operator can turn the whole site's SNMP crawl off
 * (it isn't always wanted). One row per school.
 */
export const schoolPolicy = pgTable("school_policy", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id")
    .notNull()
    .unique()
    .references(() => schools.id, { onDelete: "cascade" }),
  /** Master switch for the SNMP topology crawl across this school's sensors. */
  snmpEnabled: boolean("snmp_enabled").notNull().default(true),
  updatedBy: integer("updated_by").references(() => users.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
