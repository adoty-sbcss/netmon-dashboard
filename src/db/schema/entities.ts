/**
 * Canonical current-state layer — the durable, deduplicated view built at
 * ingestion time by stitching across bundles/scans. This is what the network
 * maps render and what survives the 30-day purge of the time-series tables
 * (Section 5b + 9 of docs/DESIGN.md).
 *
 * Dedup keys: chassis_id for switches, mac for hosts.
 */
import {
  pgTable,
  serial,
  text,
  integer,
  date,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { districts, schools } from "./app";

/** Canonical switch, deduped on chassis_id within a district. */
export const entitiesSwitch = pgTable(
  "entities_switch",
  {
    id: serial("id").primaryKey(),
    districtId: integer("district_id")
      .notNull()
      .references(() => districts.id, { onDelete: "cascade" }),
    schoolId: integer("school_id").references(() => schools.id, {
      onDelete: "set null",
    }),
    chassisId: text("chassis_id").notNull(),
    systemName: text("system_name"),
    systemDescription: text("system_description"),
    mgmtIp: text("mgmt_ip"),
    capabilities: text("capabilities").array(),
    attributes: jsonb("attributes").notNull().default({}),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("uq_switch_district_chassis").on(t.districtId, t.chassisId),
    index("idx_switch_school").on(t.schoolId),
  ],
);

/** Canonical host/device, deduped on mac within a district. */
export const entitiesHost = pgTable(
  "entities_host",
  {
    id: serial("id").primaryKey(),
    districtId: integer("district_id")
      .notNull()
      .references(() => districts.id, { onDelete: "cascade" }),
    schoolId: integer("school_id").references(() => schools.id, {
      onDelete: "set null",
    }),
    mac: text("mac").notNull(),
    ip: text("ip"),
    hostname: text("hostname"),
    vendor: text("vendor"),
    attributes: jsonb("attributes").notNull().default({}),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("uq_host_district_mac").on(t.districtId, t.mac),
    index("idx_host_school").on(t.schoolId),
  ],
);

/**
 * Stitched topology snapshots (one current row per scope per kind). graph holds
 * { nodes, edges }. `kind` distinguishes the physical (LLDP/CDP) map from the
 * logical (VLAN/gateway/subnet) map.
 */
export const topologySnapshots = pgTable(
  "topology_snapshots",
  {
    id: serial("id").primaryKey(),
    /** 'physical' | 'logical' */
    kind: text("kind").notNull(),
    /** 'district' | 'school' */
    scopeType: text("scope_type").notNull(),
    scopeId: integer("scope_id").notNull(),
    graph: jsonb("graph").notNull().default({}),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("uq_topology_kind_scope").on(t.kind, t.scopeType, t.scopeId),
  ],
);

/** Small durable daily metrics rollup per district (and optionally school). */
export const healthRollupDaily = pgTable(
  "health_rollup_daily",
  {
    id: serial("id").primaryKey(),
    districtId: integer("district_id")
      .notNull()
      .references(() => districts.id, { onDelete: "cascade" }),
    schoolId: integer("school_id").references(() => schools.id, {
      onDelete: "cascade",
    }),
    day: date("day").notNull(),
    /** broadcastPct, multicastPct, rxErrorRate, deviceCount, findingCount, ... */
    metrics: jsonb("metrics").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("uq_rollup_district_school_day").on(
      t.districtId,
      t.schoolId,
      t.day,
    ),
  ],
);
