/**
 * iperf3 throughput testing (#10). Per-district target server + the results
 * sensors report back (on-demand via the command queue, or scheduled per config
 * pushed through desired_config). The sensor POSTs results to
 * /api/sensor/iperf-result.
 */
import {
  pgTable,
  serial,
  integer,
  bigint,
  text,
  boolean,
  doublePrecision,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { districts, schools, sensors, users } from "./app";

/** One iperf3 target server per district (the box runs `iperf3 -c` against it). */
export const districtIperf = pgTable("district_iperf", {
  districtId: integer("district_id")
    .primaryKey()
    .references(() => districts.id, { onDelete: "cascade" }),
  serverHost: text("server_host"),
  serverPort: integer("server_port").notNull().default(5201),
  /** Master switch for iperf in this district. */
  enabled: boolean("enabled").notNull().default(false),
  updatedBy: integer("updated_by").references(() => users.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** A single iperf3 run reported by a sensor. */
export const iperfResults = pgTable(
  "iperf_results",
  {
    id: serial("id").primaryKey(),
    sensorId: integer("sensor_id")
      .notNull()
      .references(() => sensors.id, { onDelete: "cascade" }),
    /** 'manual' | 'scheduled'. */
    trigger: text("trigger"),
    serverHost: text("server_host"),
    serverPort: integer("server_port"),
    /** 'tcp' | 'udp'. */
    protocol: text("protocol"),
    /** 'down' (server→sensor, iperf -R) | 'up' (sensor→server). */
    direction: text("direction"),
    durationSec: integer("duration_sec"),
    throughputMbps: doublePrecision("throughput_mbps"),
    retransmits: integer("retransmits"),
    jitterMs: doublePrecision("jitter_ms"),
    lossPct: doublePrecision("loss_pct"),
    ok: boolean("ok").notNull().default(true),
    error: text("error"),
    /** Raw parsed iperf3 summary (jsonb) for drill-down. */
    raw: jsonb("raw"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("idx_iperf_results_sensor").on(t.sensorId, t.createdAt)],
);

/**
 * A single PUBLIC internet speed test reported by a sensor (PERF-2) — the WAN
 * counterpart to iperf's internal throughput. Separate table (iperf_results has
 * no type discriminator); `provider` distinguishes Ookla vs Cloudflare.
 */
export const speedtestResults = pgTable(
  "speedtest_results",
  {
    id: serial("id").primaryKey(),
    sensorId: integer("sensor_id")
      .notNull()
      .references(() => sensors.id, { onDelete: "cascade" }),
    /** 'manual' | 'scheduled'. */
    trigger: text("trigger"),
    /** 'ookla' | 'cloudflare'. */
    provider: text("provider"),
    downloadMbps: doublePrecision("download_mbps"),
    uploadMbps: doublePrecision("upload_mbps"),
    latencyMs: doublePrecision("latency_ms"),
    jitterMs: doublePrecision("jitter_ms"),
    lossPct: doublePrecision("loss_pct"),
    /** Test server name/location (Ookla) or "Cloudflare". */
    server: text("server"),
    isp: text("isp"),
    /** Shareable result page (Ookla). */
    resultUrl: text("result_url"),
    externalIp: text("external_ip"),
    ok: boolean("ok").notNull().default(true),
    error: text("error"),
    raw: jsonb("raw"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("idx_speedtest_results_sensor").on(t.sensorId, t.createdAt)],
);

/**
 * A single latency/jitter/loss probe reported by a sensor (PERF-4). One row per
 * target per cycle; `label` is 'internet' | 'gateway' | 'dns'.
 */
export const latencyResults = pgTable(
  "latency_results",
  {
    id: serial("id").primaryKey(),
    sensorId: integer("sensor_id")
      .notNull()
      .references(() => sensors.id, { onDelete: "cascade" }),
    /** 'manual' | 'scheduled'. */
    trigger: text("trigger"),
    /** 'internet' | 'gateway' | 'dns'. */
    label: text("label"),
    target: text("target"),
    latencyMs: doublePrecision("latency_ms"),
    jitterMs: doublePrecision("jitter_ms"),
    lossPct: doublePrecision("loss_pct"),
    ok: boolean("ok").notNull().default(true),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("idx_latency_results_sensor").on(t.sensorId, t.createdAt)],
);

/**
 * PERF-5: a single website-performance probe reported by a sensor. One row per URL
 * per cycle; times are CUMULATIVE ms from the request start (dns <= tcp <= tls <=
 * ttfb <= total), matching curl's timing model. trigger = 'manual' | 'scheduled'.
 * Sensor POSTs to /api/sensor/webperf-result.
 */
export const webperfResults = pgTable(
  "webperf_results",
  {
    id: serial("id").primaryKey(),
    sensorId: integer("sensor_id")
      .notNull()
      .references(() => sensors.id, { onDelete: "cascade" }),
    trigger: text("trigger"),
    url: text("url"),
    dnsMs: doublePrecision("dns_ms"),
    tcpMs: doublePrecision("tcp_ms"),
    tlsMs: doublePrecision("tls_ms"),
    ttfbMs: doublePrecision("ttfb_ms"),
    totalMs: doublePrecision("total_ms"),
    httpStatus: integer("http_status"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    speedMbps: doublePrecision("speed_mbps"),
    ok: boolean("ok").notNull().default(true),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("idx_webperf_results_sensor").on(t.sensorId, t.createdAt)],
);

/** PERF-5: master switch for website testing in a district (one row per district). */
export const districtWebperf = pgTable("district_webperf", {
  districtId: integer("district_id")
    .primaryKey()
    .references(() => districts.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * PERF-5: the district-managed list of websites to test (end-user experience). The
 * list is materialized into each sensor's desired_config (webperf_urls) on change;
 * an empty list falls back to a couple of built-in defaults at push time.
 */
export const districtWebperfUrls = pgTable(
  "district_webperf_urls",
  {
    id: serial("id").primaryKey(),
    districtId: integer("district_id")
      .notNull()
      .references(() => districts.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    label: text("label"),
    addedBy: integer("added_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("uq_webperf_url_district").on(t.districtId, t.url)],
);

/**
 * PERF-3: the admin-set committed/provisioned internet rate for a SCHOOL's WAN
 * uplink. Uplink utilization (computed from SNMP counter deltas) is shown vs
 * THIS rate — not the physical port speed — because a 10G/100G port may carry
 * only 1–10G of paid transport. One row per school (the school's single WAN
 * circuit); per-interface overrides can come later.
 */
export const schoolCommittedRate = pgTable("school_committed_rate", {
  schoolId: integer("school_id")
    .primaryKey()
    .references(() => schools.id, { onDelete: "cascade" }),
  committedMbps: integer("committed_mbps"),
  label: text("label"),
  note: text("note"),
  updatedBy: integer("updated_by").references(() => users.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * PERF-3: a single uplink octet-counter sample, ingested from a bundle's SNMP
 * crawl (collector samples ifHCInOctets/ifHCOutOctets for the resolved uplink
 * ifIndex only). in/out Mbps are computed at ingest as the counter delta vs the
 * previous sample for the same (school, chassis, ifindex) over the elapsed time
 * — null on the first sample or across a counter reset. One row per crawled
 * uplink per ingest (topology crawl runs ~hourly, so this is average util over
 * the interval). The school's WAN uplink = the busiest sampled uplink.
 */
export const uplinkSamples = pgTable(
  "uplink_samples",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    sensorId: integer("sensor_id").references(() => sensors.id, {
      onDelete: "set null",
    }),
    /** SNMP chassis id of the switch the uplink lives on. */
    chassisId: text("chassis_id").notNull(),
    ifindex: text("ifindex").notNull(),
    ifName: text("if_name"),
    /** Physical port speed (ifHighSpeed), for reference vs the committed rate. */
    speedMbps: integer("speed_mbps"),
    inOctets: bigint("in_octets", { mode: "number" }),
    outOctets: bigint("out_octets", { mode: "number" }),
    /** Computed vs the previous sample; null when not computable. */
    inMbps: doublePrecision("in_mbps"),
    outMbps: doublePrecision("out_mbps"),
    /** Wall-clock instant the counter was sampled on the box. */
    sampledAt: timestamp("sampled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("idx_uplink_samples_school").on(t.schoolId, t.sampledAt),
    index("idx_uplink_samples_iface").on(
      t.schoolId,
      t.chassisId,
      t.ifindex,
      t.sampledAt,
    ),
  ],
);
