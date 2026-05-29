/**
 * Time-series tables mirroring NetMon's collector schema (db/init.sql), as
 * ingested from hourly bundles. HOT data: expires at 30 days (Section 9 of
 * docs/DESIGN.md). The durable, stitched view lives in schema/entities.ts.
 *
 * NetMon stores ip/mac as INET/MACADDR; here we keep them as text since this DB
 * is populated by parsing bundle JSON and the values are display-only.
 */
import {
  pgTable,
  serial,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { sensors, ingestedBundles } from "./app";

/** One NetMon scan run. Carries identity slugs + link to the originating bundle. */
export const scanRuns = pgTable(
  "scan_runs",
  {
    id: serial("id").primaryKey(),
    /** Resolved sensor (district/school/device). Nullable until matched. */
    sensorId: integer("sensor_id").references(() => sensors.id, {
      onDelete: "cascade",
    }),
    bundleId: integer("bundle_id").references(() => ingestedBundles.id, {
      onDelete: "cascade",
    }),
    /** Original NetMon scan_runs.id from the source box (not unique here). */
    sourceScanId: integer("source_scan_id"),
    districtSlug: text("district_slug"),
    schoolSlug: text("school_slug"),
    deviceSlug: text("device_slug"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    triggerReason: text("trigger_reason"),
    interface: text("interface"),
    interfaceCidr: text("interface_cidr"),
    gatewayIp: text("gateway_ip"),
    gatewayMac: text("gateway_mac"),
    networkId: text("network_id"),
    durationSec: integer("duration_sec"),
    isPrimary: boolean("is_primary").notNull().default(false),
    notes: text("notes"),
    error: text("error"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("idx_scan_runs_sensor").on(t.sensorId, t.startedAt),
    index("idx_scan_runs_started").on(t.startedAt),
  ],
);

export const devices = pgTable(
  "devices",
  {
    id: serial("id").primaryKey(),
    scanRunId: integer("scan_run_id")
      .notNull()
      .references(() => scanRuns.id, { onDelete: "cascade" }),
    ip: text("ip"),
    mac: text("mac"),
    hostname: text("hostname"),
    vendor: text("vendor"),
    source: text("source"),
    extra: jsonb("extra").notNull().default({}),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_devices_scan").on(t.scanRunId),
    index("idx_devices_mac").on(t.mac),
  ],
);

export const neighbors = pgTable(
  "neighbors",
  {
    id: serial("id").primaryKey(),
    scanRunId: integer("scan_run_id")
      .notNull()
      .references(() => scanRuns.id, { onDelete: "cascade" }),
    localPort: text("local_port"),
    protocol: text("protocol"),
    chassisId: text("chassis_id"),
    portId: text("port_id"),
    systemName: text("system_name"),
    systemDescription: text("system_description"),
    portDescription: text("port_description"),
    vlanId: integer("vlan_id"),
    mgmtIp: text("mgmt_ip"),
    capabilities: text("capabilities").array(),
    seenAt: timestamp("seen_at", { withTimezone: true }),
    extra: jsonb("extra").notNull().default({}),
  },
  (t) => [index("idx_neighbors_scan").on(t.scanRunId)],
);

export const trafficStats = pgTable(
  "traffic_stats",
  {
    id: serial("id").primaryKey(),
    scanRunId: integer("scan_run_id")
      .notNull()
      .references(() => scanRuns.id, { onDelete: "cascade" }),
    interface: text("interface"),
    bucketStart: timestamp("bucket_start", { withTimezone: true }),
    bucketEnd: timestamp("bucket_end", { withTimezone: true }),
    rxPackets: bigint("rx_packets", { mode: "number" }),
    rxBytes: bigint("rx_bytes", { mode: "number" }),
    rxErrors: bigint("rx_errors", { mode: "number" }),
    rxDropped: bigint("rx_dropped", { mode: "number" }),
    txPackets: bigint("tx_packets", { mode: "number" }),
    txBytes: bigint("tx_bytes", { mode: "number" }),
    broadcastPackets: bigint("broadcast_packets", { mode: "number" }),
    multicastPackets: bigint("multicast_packets", { mode: "number" }),
    tsharkTotalPackets: bigint("tshark_total_packets", { mode: "number" }),
  },
  (t) => [index("idx_traffic_scan").on(t.scanRunId)],
);

/**
 * SNMP polls. Populated with a CURATED SUBSET only — raw SNMP is ~4,471
 * rows/scan and mostly redundant. Switch identity (model/name/firmware) goes to
 * entities_switch.attributes; only useful rows land here. Full raw stays in the
 * Blob ZIP, so more fields can be back-extracted later without re-pulling SFTP.
 */
export const snmpPolls = pgTable(
  "snmp_polls",
  {
    id: serial("id").primaryKey(),
    scanRunId: integer("scan_run_id")
      .notNull()
      .references(() => scanRuns.id, { onDelete: "cascade" }),
    deviceIp: text("device_ip"),
    oid: text("oid"),
    oidName: text("oid_name"),
    value: text("value"),
    polledAt: timestamp("polled_at", { withTimezone: true }),
  },
  (t) => [index("idx_snmp_scan").on(t.scanRunId)],
);

export const dhcpObservations = pgTable(
  "dhcp_observations",
  {
    id: serial("id").primaryKey(),
    scanRunId: integer("scan_run_id")
      .notNull()
      .references(() => scanRuns.id, { onDelete: "cascade" }),
    messageType: text("message_type"),
    serverIp: text("server_ip"),
    serverMac: text("server_mac"),
    clientMac: text("client_mac"),
    offeredIp: text("offered_ip"),
    subnetMask: text("subnet_mask"),
    router: text("router"),
    dnsServers: text("dns_servers"),
    seenAt: timestamp("seen_at", { withTimezone: true }),
  },
  (t) => [index("idx_dhcp_scan").on(t.scanRunId)],
);

export const stpEvents = pgTable(
  "stp_events",
  {
    id: serial("id").primaryKey(),
    scanRunId: integer("scan_run_id")
      .notNull()
      .references(() => scanRuns.id, { onDelete: "cascade" }),
    bpduType: text("bpdu_type"),
    rootBridgeId: text("root_bridge_id"),
    bridgeId: text("bridge_id"),
    portId: text("port_id"),
    rootPathCost: bigint("root_path_cost", { mode: "number" }),
    topologyChange: boolean("topology_change"),
    seenAt: timestamp("seen_at", { withTimezone: true }),
  },
  (t) => [index("idx_stp_scan").on(t.scanRunId)],
);

export const findings = pgTable(
  "findings",
  {
    id: serial("id").primaryKey(),
    scanRunId: integer("scan_run_id")
      .notNull()
      .references(() => scanRuns.id, { onDelete: "cascade" }),
    rule: text("rule").notNull(),
    severity: text("severity").notNull(),
    title: text("title").notNull(),
    detail: text("detail"),
    evidence: jsonb("evidence").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_findings_scan").on(t.scanRunId),
    index("idx_findings_severity").on(t.severity),
  ],
);
