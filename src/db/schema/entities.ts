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
  doublePrecision,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { districts, schools, users } from "./app";

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
    // Operator purge: a REVERSIBLE exclusion that hides the device from the
    // inventory/map and feeds the per-school SNMP exclude list pushed to
    // sensors. Preserved across re-ingestion (the ingest upsert sets explicit
    // columns only, never these), so a purged device stays purged.
    excludedAt: timestamp("excluded_at", { withTimezone: true }),
    excludedBy: integer("excluded_by").references(() => users.id, {
      onDelete: "set null",
    }),
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
    /** Best-effort classification: 'switch' | 'router' | 'ap' | 'firewall' |
     *  'printer' | 'phone' | 'camera' | 'computer' | 'server' | 'mobile' |
     *  'storage' | 'iot' | 'vm' | 'unknown'. Derived from OUI vendor + hostname
     *  + SNMP at ingest (see src/lib/oui). */
    deviceType: text("device_type"),
    /** Operator's MANUAL classification (bulk reclassify). When set it wins over
     *  the auto `deviceType` everywhere the effective type is read, and the
     *  ingest upsert never touches it — so a manual class survives re-scans. */
    deviceTypeOverride: text("device_type_override"),
    attributes: jsonb("attributes").notNull().default({}),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    // Operator purge — see entitiesSwitch.excludedAt. Reversible, survives
    // re-ingestion.
    excludedAt: timestamp("excluded_at", { withTimezone: true }),
    excludedBy: integer("excluded_by").references(() => users.id, {
      onDelete: "set null",
    }),
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

/**
 * Saved manual node positions for the network map. When an admin drags nodes and
 * clicks Save, one row per node persists its (x,y) in the map's 1000×700 layout
 * space; the renderer prefers these over the computed layout.
 */
export const topologyPositions = pgTable(
  "topology_positions",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    /** 'physical' | 'logical' */
    kind: text("kind").notNull(),
    nodeId: text("node_id").notNull(),
    x: doublePrecision("x").notNull(),
    y: doublePrecision("y").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [uniqueIndex("uq_topo_pos_school_kind_node").on(t.schoolId, t.kind, t.nodeId)],
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
