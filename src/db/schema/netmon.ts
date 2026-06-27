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
  doublePrecision,
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
    // PROV-5 Phase 3: VLAN as a first-class dimension. The collector tags each scan
    // with the 802.1Q VLAN it ran on (and the parent trunk NIC); carrying it here
    // makes "which VLAN was this device seen on" queryable instead of parsing
    // eth0.<id> from the interface name.
    vlanId: integer("vlan_id"),
    parentInterface: text("parent_interface"),
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
    index("idx_scan_runs_vlan").on(t.vlanId),
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
  (t) => [
    index("idx_neighbors_scan").on(t.scanRunId),
    // Switch detail joins neighbor sightings by chassis — index it so the lookup
    // isn't a full scan.
    index("idx_neighbors_chassis").on(t.chassisId),
  ],
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
  (t) => [
    index("idx_snmp_scan").on(t.scanRunId),
    // Device-detail pages look up a single device's attributes by IP across a huge
    // table; without this they do a full scan (the main detail-page slowness).
    index("idx_snmp_device_ip").on(t.deviceIp),
    // Device/switch detail filter `device_ip = X AND oid_name (<>|=) 'ifTable'`;
    // the composite lets both predicates resolve from one index.
    index("idx_snmp_device_oid").on(t.deviceIp, t.oidName),
  ],
);

/**
 * Per-host switch port, derived at ingest by walking the BRIDGE-MIB chain in the
 * full SNMP poll set: MAC -> dot1dTpFdbPort (bridge port) -> dot1dBasePortIfIndex
 * (ifIndex) -> ifName (e.g. "Gi1/0/12"). One row per (scan, mac) that resolves to
 * a real learned port. Bridge port 0 (= not learned on a specific port) is treated
 * as unresolved and not stored. sourceDeviceIp is the polled switch/gateway whose
 * forwarding table produced the mapping.
 */
export const hostSwitchPorts = pgTable(
  "host_switch_ports",
  {
    id: serial("id").primaryKey(),
    scanRunId: integer("scan_run_id")
      .notNull()
      .references(() => scanRuns.id, { onDelete: "cascade" }),
    sourceDeviceIp: text("source_device_ip"),
    mac: text("mac").notNull(),
    bridgePort: integer("bridge_port"),
    ifIndex: integer("if_index"),
    ifName: text("if_name"),
  },
  (t) => [
    index("idx_host_switch_ports_scan").on(t.scanRunId),
    index("idx_host_switch_ports_mac").on(t.mac),
    // FDB attachment lookups key on the polled switch/gateway IP across this
    // fast-growing per-scan table (map overlay + switch/host detail "connected").
    index("idx_host_switch_ports_source_ip").on(t.sourceDeviceIp),
  ],
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
    // Device-fingerprint options (client-originated messages): 60 vendor class,
    // 55 parameter request list, 12 advertised hostname. Used to classify
    // endpoints that never speak SNMP and to fill missing hostnames.
    vendorClassId: text("vendor_class_id"),
    paramReqList: text("param_req_list"),
    clientHostname: text("client_hostname"),
  },
  (t) => [
    index("idx_dhcp_scan").on(t.scanRunId),
    // Host detail looks up a device's DHCP fingerprint by client MAC.
    index("idx_dhcp_client_mac").on(t.clientMac),
  ],
);

/**
 * DNS resolver health — one row per (scan, resolver). The sensor probes each
 * resolver it can find (DHCP-provided, public, system stub) with a fixed query
 * set and records reachability, latency, and whether NXDOMAIN responses were
 * rewritten (captive-portal / filtering tell). Authoritative aggregate from the
 * collector; per-query detail lives in dns_probes.
 */
export const dnsResolverHealth = pgTable(
  "dns_resolver_health",
  {
    id: serial("id").primaryKey(),
    scanRunId: integer("scan_run_id")
      .notNull()
      .references(() => scanRuns.id, { onDelete: "cascade" }),
    resolverIp: text("resolver_ip"),
    resolverSource: text("resolver_source"),
    probes: integer("probes"),
    ok: integer("ok"),
    errors: integer("errors"),
    nxdomainRewrite: boolean("nxdomain_rewrite"),
    meanMs: doublePrecision("mean_ms"),
  },
  (t) => [index("idx_dns_resolver_health_scan").on(t.scanRunId)],
);

/** Individual DNS probe results (per scan): one row per resolver×query. */
export const dnsProbes = pgTable(
  "dns_probes",
  {
    id: serial("id").primaryKey(),
    scanRunId: integer("scan_run_id")
      .notNull()
      .references(() => scanRuns.id, { onDelete: "cascade" }),
    resolverIp: text("resolver_ip"),
    resolverSource: text("resolver_source"),
    queryName: text("query_name"),
    queryType: text("query_type"),
    expectedStatus: text("expected_status"),
    status: text("status"),
    queryTimeMs: integer("query_time_ms"),
    answerCount: integer("answer_count"),
    answersText: text("answers_text"),
    error: text("error"),
    probedAt: timestamp("probed_at", { withTimezone: true }),
  },
  (t) => [index("idx_dns_probes_scan").on(t.scanRunId)],
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

/**
 * Network-device reachability — one row per (scan, infrastructure candidate).
 * The collector pings + traceroutes the gateway / LLDP mgmt IPs / network-vendor
 * OUIs and records whether each answers SNMP. Surfaces "which switches are out
 * there, and which respond to SNMP vs. only ping" so blocked SNMP (ACL / disabled)
 * is visible at a glance instead of needing an SSH session on the sensor.
 */
export const networkReachability = pgTable(
  "network_reachability",
  {
    id: serial("id").primaryKey(),
    scanRunId: integer("scan_run_id")
      .notNull()
      .references(() => scanRuns.id, { onDelete: "cascade" }),
    ip: text("ip"),
    hostname: text("hostname"),
    vendor: text("vendor"),
    source: text("source"), // gateway | lldp | oui
    pingAlive: boolean("ping_alive"),
    pingRttMs: doublePrecision("ping_rtt_ms"),
    pingLossPct: integer("ping_loss_pct"),
    snmpResponded: boolean("snmp_responded"),
    snmpVersion: text("snmp_version"),
    tracerouteHops: integer("traceroute_hops"),
    traceroutePath: jsonb("traceroute_path").notNull().default([]),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_net_reach_scan").on(t.scanRunId),
    index("idx_net_reach_ip").on(t.ip),
  ],
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
