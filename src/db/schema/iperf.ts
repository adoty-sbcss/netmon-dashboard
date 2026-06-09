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
  text,
  boolean,
  doublePrecision,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { districts, sensors, users } from "./app";

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
