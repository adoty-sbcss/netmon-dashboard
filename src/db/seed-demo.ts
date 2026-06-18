/**
 * Seed (or reset) a fully-populated FAKE district for demos / screenshots / video.
 *
 *   npm run seed:demo                 # create the demo district (idempotent-ish)
 *   npm run seed:demo -- --reset      # wipe the demo district first, then recreate
 *   npm run seed:demo -- --keep-bundles  # leave the generated bundle dirs on disk
 *
 * Env toggles mirror the flags for the in-Azure job run (az can't pass --force):
 *   SEED_DEMO_ALLOW_PROD=1  (= --force)   SEED_DEMO_RESET=1  (= --reset)
 *
 * HOW IT WORKS (hybrid):
 *   1. SYNTHESIZES extracted NetMon bundle dirs (exact src/ingest/bundle.ts layout)
 *      and runs them through the REAL ingest pipeline → authentic devices, switch/
 *      host entities, physical+logical maps, device classification (incl. the SNMP
 *      bridge-table FDB chain so the host detail page shows switch + exact port),
 *      uplink-utilization samples, and the daily health rollup.
 *   2. DIRECTLY SEEDS the tables ingest does NOT produce: `issues` (the AI findings
 *      slate, incl. the hero flapping-port finding with a drafted fix), `ai_analyses`
 *      (the side-by-side AI report), the school WAN `committed rate`, public
 *      `speedtest` / internal `iperf` / `latency` results, and patches the demo
 *      `sensors` rows so they read HEALTHY (recent check-in, on-fleet version).
 *
 * SCENARIO ("Highlight Video v1"): Demo Unified School District, two sites.
 *   • Roosevelt High = HERO: larger (~50 devices), core + 4 access switches, HEALTHY
 *     WAN; the hero finding is a flapping core port (~40 transitions/hr) with a fix.
 *   • Lincoln Elementary = supporting: smaller (~20 devices), SATURATED WAN (~95% of
 *     the contracted rate) so the uplink chart rides the reference line.
 *
 * SAFETY: built for a LOCAL dev DB; everything lives under slug `demo-usd`, and
 * --reset only ever touches that district. Refuses a non-local DATABASE_URL unless
 * --force / SEED_DEMO_ALLOW_PROD=1.
 *
 * Run under tsx (no Next runtime), same as seed-admin.ts.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "./index";
import {
  districts,
  schools,
  sensors,
  topologySnapshots,
  ingestedBundles,
  issues,
  aiAnalyses,
  schoolCommittedRate,
  speedtestResults,
  iperfResults,
  latencyResults,
} from "./schema";
import type { AiFinding } from "./schema/ai";
import { ingestBundle } from "../ingest/ingest";
import { issueKeyFromTitle } from "../lib/issues/reconcile";
import { fleetTopSha } from "../lib/sensor-health";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const DISTRICT_SLUG = "demo-usd";
const DISTRICT_NAME = "Demo Unified School District";

const NOW = Date.now();
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();
const date = (ms: number) => new Date(ms);

// Two crawl samples 5 min apart → the uplink rate = octet delta / 300s. Kept
// recent so "last scan" reads fresh (sensors show healthy, not stalled).
const SAMPLE_SECS = 300;
const SCAN1_MS = NOW - 600_000; // 10 min ago
const SCAN2_MS = NOW - 300_000; // 5 min ago
/** Octet delta that yields `mbps` over the SAMPLE_SECS window. */
const octetsFor = (mbps: number) => Math.round((mbps * 1e6 * SAMPLE_SECS) / 8);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stable MAC from a seed string + a vendor OUI prefix (so it looks real). */
function mac(oui: string, seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const b = (n: number) => ((h >>> (n * 8)) & 0xff).toString(16).padStart(2, "0");
  return `${oui}:${b(0)}:${b(1)}:${b(2)}`;
}

/** MAC "ac:bc:32:1a:2b:3c" → decimal-octet OID suffix "172.188.50.26.43.60". */
function macOctets(m: string): string {
  return m.split(":").map((h) => parseInt(h, 16)).join(".");
}

// ---------------------------------------------------------------------------
// Device / switch / school specs
// ---------------------------------------------------------------------------

interface HostSpec {
  host: string;
  vendor: string;
  oui: string;
  ip: string; // last octet appended to the school subnet base
  serviceHint?: string;
  serviceTypes?: string[];
  /** A device NetMon found but couldn't classify (blank vendor/hostname). */
  unidentified?: boolean;
}

interface SwitchSpec {
  chassis: string;
  name: string;
  descr: string;
  mgmtIp: string;
}

interface SchoolSpec {
  slug: string;
  name: string;
  sensor: string;
  subnet: string;
  cidr: string;
  gatewayIp: string;
  gatewayMac: string;
  vlan: number;
  core: SwitchSpec;
  access: SwitchSpec[];
  hosts: HostSpec[];
  // --- WAN uplink (PERF-3) ---
  committedMbps: number;
  uplinkInMbps: number;
  uplinkOutMbps: number;
  // --- hero finding: a flapping port on the core (Roosevelt only) ---
  flappingPort?: { ifindex: string; name: string; perHour: number };
  // --- background findings ---
  rogueDhcpIp?: string;
  rogueDhcpMac?: string;
  loop?: boolean; // spanning-tree loop (looped-cable narrative)
  broadcastPct: number;
}

/** Expand a repeated device class into N hosts with sequential names + IPs. */
function fleet(
  prefix: string,
  vendor: string,
  oui: string,
  ipStart: number,
  count: number,
  extra: Partial<HostSpec> = {},
): HostSpec[] {
  return Array.from({ length: count }, (_, i) => ({
    host: `${prefix}-${String(i + 1).padStart(2, "0")}`,
    vendor,
    oui,
    ip: String(ipStart + i),
    ...extra,
  }));
}

const AP = "Cisco Meraki";
const HP = "HP Inc.";
const DELL = "Dell Inc.";
const GOOG = "Google, Inc.";

// ---- ROOSEVELT HIGH — the HERO site ----

const ROOSEVELT: SchoolSpec = {
  slug: "roosevelt-hs",
  name: "Roosevelt High School",
  sensor: "mdf",
  subnet: "10.30.20",
  cidr: "10.30.20.0/24",
  gatewayIp: "10.30.20.1",
  gatewayMac: mac("00:1b:17", "roosevelt-gw"),
  vlan: 20,
  committedMbps: 1000,
  uplinkInMbps: 310, // ~31% of contracted — healthy headroom
  uplinkOutMbps: 120,
  flappingPort: { ifindex: "12", name: "GigabitEthernet1/0/12", perHour: 40 },
  rogueDhcpIp: "10.30.20.205",
  rogueDhcpMac: mac("b8:27:eb", "roosevelt-rogue"),
  loop: true,
  broadcastPct: 2.1,
  core: {
    chassis: mac("00:1b:54", "roosevelt-core"),
    name: "roosevelt-core-sw1",
    descr: "Cisco IOS Software, C9500 (CAT9K), Version 17.12",
    mgmtIp: "10.30.20.2",
  },
  access: [
    { chassis: mac("00:1b:54", "roosevelt-asw1"), name: "roosevelt-asw-200hall",
      descr: "Cisco IOS Software, C9200L, Version 17.9", mgmtIp: "10.30.20.3" },
    { chassis: mac("00:1b:54", "roosevelt-asw2"), name: "roosevelt-asw-300hall",
      descr: "Cisco IOS Software, C9200L, Version 17.9", mgmtIp: "10.30.20.4" },
    { chassis: mac("00:1b:54", "roosevelt-asw3"), name: "roosevelt-asw-gym",
      descr: "Aruba 6300M, Version 10.10", mgmtIp: "10.30.20.5" },
    // "Undocumented" switch — only reached via the neighbor crawl, not cabled to
    // the sensor; NetMon auto-discovered it walking the fabric.
    { chassis: mac("00:1b:54", "roosevelt-asw4"), name: "roosevelt-asw-library",
      descr: "Aruba 6300M, Version 10.10", mgmtIp: "10.30.20.6" },
  ],
  hosts: [
    { host: "fw-edge-01", vendor: "Fortinet, Inc.", oui: "00:09:0f", ip: "1" },
    // wireless
    ...fleet("ap-200hall", AP, "0c:8d:db", 11, 2),
    ...fleet("ap-300hall", AP, "0c:8d:db", 13, 2),
    { host: "ap-gym-01", vendor: AP, oui: "0c:8d:db", ip: "15" },
    { host: "ap-library-01", vendor: AP, oui: "0c:8d:db", ip: "16" },
    { host: "ap-cafeteria-01", vendor: AP, oui: "0c:8d:db", ip: "17" },
    // servers / storage
    { host: "srv-app01", vendor: DELL, oui: "00:14:22", ip: "20" },
    { host: "srv-sql01", vendor: DELL, oui: "00:14:22", ip: "21" },
    { host: "qnap-backup", vendor: "QNAP Systems", oui: "24:5e:be", ip: "23" },
    // printers
    { host: "gym-laserjet-09", vendor: HP, oui: "3c:52:82", ip: "31",
      serviceHint: "printer", serviceTypes: ["_ipp._tcp.local"] },
    { host: "admin-mfp-ricoh", vendor: "Ricoh Company", oui: "00:26:73", ip: "32",
      serviceHint: "printer", serviceTypes: ["_ipp._tcp.local", "_printer._tcp.local"] },
    { host: "library-laserjet-02", vendor: HP, oui: "3c:52:82", ip: "33",
      serviceHint: "printer", serviceTypes: ["_ipp._tcp.local"] },
    // AV / displays
    { host: "auditorium-appletv", vendor: "Apple, Inc.", oui: "ac:bc:32", ip: "42",
      serviceHint: "apple-av", serviceTypes: ["_airplay._tcp.local"] },
    { host: "rm210-chromecast", vendor: GOOG, oui: "f4:f5:d8", ip: "43",
      serviceHint: "chromecast", serviceTypes: ["_googlecast._tcp.local"] },
    { host: "promethean-rm210", vendor: "Promethean Limited", oui: "00:23:a7", ip: "45" },
    { host: "promethean-rm305", vendor: "Promethean Limited", oui: "00:23:a7", ip: "46" },
    // cameras
    { host: "hik-cam-parkinglot", vendor: "Hangzhou Hikvision", oui: "44:19:b6", ip: "61",
      serviceHint: "camera", serviceTypes: ["_rtsp._tcp.local"] },
    { host: "hik-cam-mainhall", vendor: "Hangzhou Hikvision", oui: "44:19:b6", ip: "62",
      serviceHint: "camera", serviceTypes: ["_rtsp._tcp.local"] },
    { host: "hik-cam-gym", vendor: "Hangzhou Hikvision", oui: "44:19:b6", ip: "63",
      serviceHint: "camera", serviceTypes: ["_rtsp._tcp.local"] },
    { host: "axis-cam-busloop", vendor: "Axis Communications AB", oui: "ac:cc:8e", ip: "64",
      serviceHint: "camera", serviceTypes: ["_axis-video._tcp.local", "_rtsp._tcp.local"] },
    // VoIP phones
    { host: "yealink-mainoffice", vendor: "Yealink Network", oui: "80:5e:c0", ip: "71" },
    { host: "yealink-counseling", vendor: "Yealink Network", oui: "80:5e:c0", ip: "72" },
    { host: "yealink-attendance", vendor: "Yealink Network", oui: "80:5e:c0", ip: "73" },
    { host: "yealink-library", vendor: "Yealink Network", oui: "80:5e:c0", ip: "74" },
    // workstations (hostname "...-pc-0N" → classifies as computer)
    ...fleet("lab301-pc", DELL, "18:db:f2", 120, 6),
    ...fleet("frontoffice-pc", DELL, "18:db:f2", 126, 2),
    ...fleet("library-pc", DELL, "18:db:f2", 128, 2),
    // chromebook carts (hostname contains "chromebook" → computer)
    ...fleet("chromebook-cart-c", GOOG, "a4:77:33", 140, 8),
    ...fleet("chromebook-cart-d", GOOG, "a4:77:33", 150, 6),
    // the mystery device — found, but NetMon can't classify it
    { host: "", vendor: "", oui: "9c:8e:99", ip: "209", unidentified: true },
  ],
};

// ---- LINCOLN ELEMENTARY — supporting site (saturated WAN) ----

const LINCOLN: SchoolSpec = {
  slug: "lincoln-es",
  name: "Lincoln Elementary",
  sensor: "mdf",
  subnet: "10.20.10",
  cidr: "10.20.10.0/24",
  gatewayIp: "10.20.10.1",
  gatewayMac: mac("00:1b:17", "lincoln-gw"),
  vlan: 10,
  committedMbps: 200,
  uplinkInMbps: 190, // ~95% of contracted — riding the line
  uplinkOutMbps: 28,
  broadcastPct: 1.4,
  core: {
    chassis: mac("00:1b:54", "lincoln-core"),
    name: "lincoln-core-sw1",
    descr: "Cisco IOS Software, C9300 (CAT9K_IOSXE), Version 17.9",
    mgmtIp: "10.20.10.2",
  },
  access: [
    { chassis: mac("00:1b:54", "lincoln-asw1"), name: "lincoln-asw-1",
      descr: "Cisco IOS Software, C9200L, Version 17.9", mgmtIp: "10.20.10.3" },
  ],
  hosts: [
    { host: "fw-edge-01", vendor: "Fortinet, Inc.", oui: "00:09:0f", ip: "1" },
    { host: "ap-bldg-a-01", vendor: "Aruba Networks", oui: "20:4c:03", ip: "11" },
    { host: "ap-bldg-b-01", vendor: "Aruba Networks", oui: "20:4c:03", ip: "12" },
    { host: "srv-dc01", vendor: DELL, oui: "00:14:22", ip: "20" },
    { host: "synology-nas", vendor: "Synology Incorporated", oui: "00:11:32", ip: "22" },
    { host: "lib-laserjet-01", vendor: HP, oui: "3c:52:82", ip: "31",
      serviceHint: "printer", serviceTypes: ["_ipp._tcp.local", "_pdl-datastream._tcp.local"] },
    { host: "rm12-appletv", vendor: "Apple, Inc.", oui: "ac:bc:32", ip: "40",
      serviceHint: "apple-av", serviceTypes: ["_airplay._tcp.local", "_raop._tcp.local"] },
    { host: "promethean-rm8", vendor: "Promethean Limited", oui: "00:23:a7", ip: "45" },
    { host: "axis-cam-frontdoor", vendor: "Axis Communications AB", oui: "ac:cc:8e", ip: "61",
      serviceHint: "camera", serviceTypes: ["_axis-video._tcp.local", "_rtsp._tcp.local"] },
    { host: "yealink-frontoffice", vendor: "Yealink Network", oui: "80:5e:c0", ip: "71" },
    ...fleet("lab204-pc", DELL, "18:db:f2", 120, 4),
    ...fleet("chromebook-cart-a", GOOG, "a4:77:33", 130, 6),
  ],
};

const SCHOOLS = [ROOSEVELT, LINCOLN];

const hostMac = (s: SchoolSpec, h: HostSpec) =>
  h.host === "fw-edge-01" ? s.gatewayMac : mac(h.oui, `${s.slug}-${h.host}-${h.ip}`);

/**
 * Deterministically attach each host (except the WAN edge) to an access switch +
 * port. Same mapping across both scans so the FDB chain is stable. Returns the
 * per-host {switch, port, ifIndex, ifName} used by both snmp FDB rows + nothing else.
 */
function attachments(s: SchoolSpec) {
  const perSwitch = new Map<string, number>();
  const out: { h: HostSpec; sw: SwitchSpec; port: number; ifIndex: number; ifName: string }[] = [];
  let i = 0;
  for (const h of s.hosts) {
    if (h.host === "fw-edge-01") continue; // the WAN edge isn't on an access port
    const sw = s.access[i % s.access.length];
    i++;
    const port = (perSwitch.get(sw.mgmtIp) ?? 0) + 1;
    perSwitch.set(sw.mgmtIp, port);
    out.push({ h, sw, port, ifIndex: 10000 + port, ifName: `Gi1/0/${port}` });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bundle synthesis
// ---------------------------------------------------------------------------

interface BundlePoint {
  scanId: number;
  startedMs: number;
  coreInOctets: number;
  coreOutOctets: number;
}

function deviceCsv(s: SchoolSpec): string {
  const head = "ip,mac,hostname,vendor,source,first_seen_at,last_seen_at";
  const rows = s.hosts.map((h) =>
    [
      `${s.subnet}.${h.ip}`,
      hostMac(s, h),
      h.host,
      `"${h.vendor}"`,
      "arp+nmap",
      iso(NOW - 6 * DAY),
      iso(SCAN2_MS),
    ].join(","),
  );
  return [head, ...rows].join("\n") + "\n";
}

function lldpNeighbors(s: SchoolSpec) {
  // Sensor is directly attached to the core; the rest of the fabric comes from
  // the SNMP crawl (snmp_topology.json) — i.e. NetMon auto-discovers it.
  return [
    {
      local_port: "eth0",
      protocol: "lldp",
      chassis_id: s.core.chassis,
      port_id: "GigabitEthernet1/0/48",
      system_name: s.core.name,
      system_description: s.core.descr,
      port_description: "uplink to NetMon sensor",
      vlan_id: s.vlan,
      mgmt_ip: s.core.mgmtIp,
      capabilities: ["bridge", "router"],
      seen_at: iso(SCAN2_MS),
    },
  ];
}

function dhcpObserved(s: SchoolSpec) {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < 6; i++) {
    out.push({
      message_type: i % 2 === 0 ? "DISCOVER" : "ACK",
      server_ip: i % 2 === 0 ? null : s.gatewayIp,
      server_mac: i % 2 === 0 ? null : s.gatewayMac,
      client_mac: mac("18:db:f2", `${s.slug}-dhcpclient-${i}`),
      offered_ip: i % 2 === 0 ? null : `${s.subnet}.${120 + i}`,
      subnet_mask: "255.255.255.0",
      router: s.gatewayIp,
      dns_servers: `${s.gatewayIp}, 1.1.1.1`,
      vendor_class_id: "MSFT 5.0",
      client_hostname: `pc-dhcp-${i}`,
      seen_at: iso(SCAN2_MS - i * 60_000),
    });
  }
  if (s.rogueDhcpIp) {
    for (let i = 0; i < 3; i++) {
      out.push({
        message_type: "OFFER",
        server_ip: s.rogueDhcpIp,
        server_mac: s.rogueDhcpMac,
        client_mac: mac("18:db:f2", `${s.slug}-victim-${i}`),
        offered_ip: `192.168.8.${50 + i}`,
        subnet_mask: "255.255.255.0",
        router: s.rogueDhcpIp,
        dns_servers: s.rogueDhcpIp,
        seen_at: iso(SCAN2_MS - 30_000 - i * 45_000),
      });
    }
  }
  return out;
}

function dnsHealth(s: SchoolSpec) {
  const probes = [
    { resolver_ip: s.gatewayIp, resolver_source: "dhcp", query_name: "www.google.com",
      query_type: "A", expected_status: "NOERROR", status: "NOERROR", query_time_ms: 12,
      answer_count: 1, probed_at: iso(SCAN2_MS) },
    { resolver_ip: "1.1.1.1", resolver_source: "static", query_name: "www.cloudflare.com",
      query_type: "A", expected_status: "NOERROR", status: "NOERROR", query_time_ms: 9,
      answer_count: 2, probed_at: iso(SCAN2_MS) },
  ];
  return {
    probe_count: probes.length,
    by_resolver: [
      { resolver_ip: s.gatewayIp, resolver_source: "dhcp", probes: 1, ok: 1, errors: 0,
        nxdomain_rewrite: false, mean_ms: 12 },
      { resolver_ip: "1.1.1.1", resolver_source: "static", probes: 1, ok: 1, errors: 0,
        nxdomain_rewrite: false, mean_ms: 9 },
    ],
    probes,
  };
}

function stpEvents(s: SchoolSpec) {
  if (!s.loop) return [];
  const b = s.access[0].chassis;
  return [
    { bpdu_type: "TCN", root_bridge_id: `32768.${s.core.chassis}`, bridge_id: `32768.${b}`,
      port_id: "128.40", root_path_cost: 8, topology_change: true, seen_at: iso(SCAN2_MS - 90_000) },
    { bpdu_type: "Config", root_bridge_id: `32768.${s.core.chassis}`, bridge_id: `32768.${b}`,
      port_id: "128.40", root_path_cost: 8, topology_change: true, seen_at: iso(SCAN2_MS - 60_000) },
  ];
}

function trafficStats(s: SchoolSpec, pt: BundlePoint) {
  const total = 3_800_000;
  return [
    {
      interface: "eth0",
      bucket_start: iso(pt.startedMs),
      bucket_end: iso(pt.startedMs + 5 * 60_000),
      rx_packets: total,
      rx_bytes: total * 560,
      rx_errors: 0,
      rx_dropped: 0,
      tx_packets: Math.round(total * 0.45),
      tx_bytes: total * 240,
      broadcast_packets: Math.round((total * s.broadcastPct) / 100),
      multicast_packets: Math.round(total * 0.025),
      tshark_total_packets: total,
    },
  ];
}

function snmpPolls(s: SchoolSpec, pt: BundlePoint) {
  const rows: Record<string, unknown>[] = [];
  const at = iso(pt.startedMs);
  for (const sw of [s.core, ...s.access]) {
    rows.push({ device_ip: sw.mgmtIp, oid: "1.3.6.1.2.1.1.5.0", oid_name: "sysName", value: sw.name, polled_at: at });
    rows.push({ device_ip: sw.mgmtIp, oid: "1.3.6.1.2.1.1.1.0", oid_name: "sysDescr", value: sw.descr, polled_at: at });
  }
  // BRIDGE-MIB FDB chain so each host resolves to a switch + exact port:
  //   dot1dTpFdbPort (mac→bridgePort) → dot1dBasePortIfIndex (port→ifIndex) → ifName.
  for (const a of attachments(s)) {
    const dev = a.sw.mgmtIp;
    rows.push({ device_ip: dev, oid: `1.3.6.1.2.1.17.4.3.1.2.${macOctets(hostMac(s, a.h))}`,
      oid_name: "dot1dTpFdbTable", value: String(a.port), polled_at: at });
    rows.push({ device_ip: dev, oid: `1.3.6.1.2.1.17.1.4.1.2.${a.port}`,
      oid_name: "dot1dBasePortIfIndex", value: String(a.ifIndex), polled_at: at });
    rows.push({ device_ip: dev, oid: `1.3.6.1.2.1.31.1.1.1.1.${a.ifIndex}`,
      oid_name: "ifName", value: a.ifName, polled_at: at });
  }
  return rows;
}

function topologyJson(s: SchoolSpec) {
  const self = "self:eth0";
  const nodes: Record<string, unknown>[] = [
    { id: self, type: "scanner", label: "NetMon (eth0)", ip: s.cidr },
    { id: `gw:${s.gatewayIp}`, type: "gateway", label: `gateway ${s.gatewayIp}`, ip: s.gatewayIp, mac: s.gatewayMac },
    { id: `switch:${s.core.chassis}`, type: "switch", label: s.core.name,
      description: s.core.descr, mgmt_ip: s.core.mgmtIp, capabilities: ["bridge", "router"] },
  ];
  const edges: Record<string, unknown>[] = [
    { source: self, target: `gw:${s.gatewayIp}`, kind: "default_route" },
    { source: self, target: `switch:${s.core.chassis}`, kind: "lldp",
      local_port: "eth0", remote_port: "Gi1/0/48", vlan: s.vlan },
  ];
  for (const h of s.hosts) {
    const ip = `${s.subnet}.${h.ip}`;
    nodes.push({ id: `host:${ip}`, type: "host", label: h.host || ip, ip, vendor: h.vendor, source: "arp" });
    edges.push({ source: self, target: `host:${ip}`, kind: "l3_seen" });
  }
  return { scan_id: 1, nodes, edges };
}

function snmpTopologyJson(s: SchoolSpec, pt: BundlePoint) {
  const coreIfaces: Record<string, unknown> = {
    "49": { name: "GigabitEthernet1/0/49", speed_mbps: 1000, oper_status: "up",
      in_errors: 0, out_errors: 0, stp_state: "forwarding" },
  };
  // Hero: a flapping access port shows up as a port logging errors on the core.
  if (s.flappingPort) {
    coreIfaces[s.flappingPort.ifindex] = {
      name: s.flappingPort.name, speed_mbps: 1000, oper_status: "up",
      in_errors: 4280, out_errors: 3910, stp_state: "forwarding",
    };
  }
  const nodes: Record<string, unknown>[] = [
    {
      chassis_id: s.core.chassis, system_name: s.core.name, system_description: s.core.descr,
      mgmt_ips: [s.core.mgmtIp], source: "snmp", capabilities: ["bridge", "router"],
      extra: {
        interfaces: coreIfaces,
        uplink: {
          ifindex: "49", name: "GigabitEthernet1/0/49", speed_mbps: 1000,
          in_octets: pt.coreInOctets, out_octets: pt.coreOutOctets,
          counter_ts: Math.floor(pt.startedMs / 1000),
        },
      },
    },
  ];
  const edges: Record<string, unknown>[] = [];
  let port = 1;
  for (const a of s.access) {
    nodes.push({
      chassis_id: a.chassis, system_name: a.name, system_description: a.descr,
      mgmt_ips: [a.mgmtIp], source: "snmp", capabilities: ["bridge"], extra: null,
    });
    edges.push({
      local_chassis_id: s.core.chassis, local_port_id: String(port),
      local_port_desc: `Gi1/0/${port}`, remote_chassis_id: a.chassis,
      remote_port_id: "49", remote_port_desc: "Gi1/0/49", via: "lldp",
    });
    port++;
  }
  return { nodes, edges };
}

function reachability(s: SchoolSpec) {
  const all = [
    { ip: s.gatewayIp, hostname: "fw-edge-01", vendor: "Fortinet, Inc.", source: "gateway" },
    { ip: s.core.mgmtIp, hostname: s.core.name, vendor: "Cisco", source: "lldp" },
    ...s.access.map((a) => ({ ip: a.mgmtIp, hostname: a.name, vendor: "Cisco/Aruba", source: "snmp" })),
  ];
  return all.map((d, i) => ({
    ip: d.ip, hostname: d.hostname, vendor: d.vendor, source: d.source,
    ping_alive: true, ping_rtt_ms: 0.6 + i * 0.3, ping_loss_pct: 0,
    snmp_responded: true, snmp_version: "2c", traceroute_hops: 1 + i,
    traceroute_path: [s.gatewayIp], checked_at: iso(SCAN2_MS),
  }));
}

function serviceDiscovery(s: SchoolSpec) {
  return {
    devices: s.hosts
      .filter((h) => h.serviceHint)
      .map((h) => ({
        ip: `${s.subnet}.${h.ip}`,
        source: "mdns",
        hostname: h.host,
        service_types: h.serviceTypes ?? [],
        device_hint: h.serviceHint,
      })),
  };
}

function findingsJson(s: SchoolSpec) {
  // Rule findings feed the time-series `findings` table → the OVERVIEW "Open
  // findings" count. The durable Issues slate (with fixes) is seeded separately.
  const out: Record<string, unknown>[] = [];
  if (s.flappingPort) {
    out.push({
      rule: "interface.flapping", severity: "high",
      title: `Port ${s.flappingPort.name} flapping`,
      detail: `~${s.flappingPort.perHour} link transitions/hour on ${s.core.name} ${s.flappingPort.name}.`,
      evidence: { ifName: s.flappingPort.name, per_hour: s.flappingPort.perHour },
      created_at: iso(SCAN2_MS),
    });
  }
  if (s.rogueDhcpIp) {
    out.push({
      rule: "dhcp.unexpected_server", severity: "high",
      title: "Unexpected DHCP server responding",
      detail: `OFFERs seen from ${s.rogueDhcpIp} (not the sanctioned scope).`,
      evidence: { authorized: s.gatewayIp, unexpected: s.rogueDhcpIp },
      created_at: iso(SCAN2_MS),
    });
  }
  if (s.committedMbps && s.uplinkInMbps / s.committedMbps >= 0.9) {
    out.push({
      rule: "uplink.saturation", severity: "high",
      title: "Internet uplink near capacity",
      detail: `WAN uplink averaging ~${Math.round((100 * s.uplinkInMbps) / s.committedMbps)}% of the ${s.committedMbps} Mbps contracted rate.`,
      evidence: { committed_mbps: s.committedMbps, in_mbps: s.uplinkInMbps },
      created_at: iso(SCAN2_MS),
    });
  }
  if (s.loop) {
    out.push({
      rule: "stp.topology_change", severity: "medium",
      title: "Repeated spanning-tree topology changes",
      detail: "TCN BPDUs recurring on an access switch — possible loop or a cable bridging two ports.",
      evidence: {},
      created_at: iso(SCAN2_MS),
    });
  }
  return out;
}

function writeBundle(dir: string, s: SchoolSpec, pt: BundlePoint) {
  const scanDir = join(dir, "scans", `scan_${pt.scanId}`);
  const rawDir = join(scanDir, "raw");
  mkdirSync(rawDir, { recursive: true });
  const meta = {
    id: pt.scanId,
    started_at: iso(pt.startedMs),
    completed_at: iso(pt.startedMs + 90_000),
    trigger_reason: "scheduled",
    interface: "eth0",
    interface_cidr: s.cidr,
    gateway_ip: s.gatewayIp,
    gateway_mac: s.gatewayMac,
    network_id: `${s.slug}-vlan${s.vlan}`,
    duration_sec: 90,
    is_primary: true,
    district_slug: DISTRICT_SLUG,
    school_slug: s.slug,
    device_slug: s.sensor,
  };
  const J = (o: unknown) => JSON.stringify(o, null, 2);
  writeFileSync(join(rawDir, "scan.json"), J(meta));
  writeFileSync(join(scanDir, "devices.csv"), deviceCsv(s));
  writeFileSync(join(rawDir, "lldp-neighbors.json"), J(lldpNeighbors(s)));
  writeFileSync(join(rawDir, "dhcp-observed.json"), J(dhcpObserved(s)));
  writeFileSync(join(rawDir, "stp-events.json"), J(stpEvents(s)));
  writeFileSync(join(rawDir, "traffic-stats.json"), J(trafficStats(s, pt)));
  writeFileSync(join(rawDir, "snmp-polls.json"), J(snmpPolls(s, pt)));
  writeFileSync(join(rawDir, "net-reachability.json"), J(reachability(s)));
  writeFileSync(join(scanDir, "dns_health.json"), J(dnsHealth(s)));
  writeFileSync(join(scanDir, "findings.json"), J(findingsJson(s)));
  writeFileSync(join(scanDir, "topology.json"), J(topologyJson(s)));
  writeFileSync(join(scanDir, "snmp_topology.json"), J(snmpTopologyJson(s, pt)));
  writeFileSync(join(scanDir, "service_discovery.json"), J(serviceDiscovery(s)));
  writeFileSync(join(dir, "README.md"), `# Demo bundle for ${s.name}\nGenerated by seed-demo.ts\n`);
}

// ---------------------------------------------------------------------------
// Issues + AI analyses (seeded directly — not produced by ingest)
// ---------------------------------------------------------------------------

interface IssueSeed {
  severity: "critical" | "high" | "medium" | "low" | "info";
  confidence: "definite" | "suggestive";
  title: string;
  detail: string;
  recommendation: string;
  status: "open" | "acknowledged" | "resolved" | "muted";
  source: "ai" | "ai-topology" | "rule";
  occurrences: number;
  firstSeenDaysAgo: number;
  lastSeenHoursAgo: number;
}

function issuesFor(slug: string): IssueSeed[] {
  if (slug === "roosevelt-hs") {
    return [
      // HERO — plain-language finding + drafted fix (renders "Fix:" on the Issues list).
      { severity: "high", confidence: "definite", source: "ai", status: "open",
        title: "Core switch access port flapping (~40 transitions/hour)",
        detail: "Port GigabitEthernet1/0/12 on roosevelt-core-sw1 has logged about 40 link up/down transitions per hour for the last 6 hours, with a rising interface error count. A port cycling this often drops the devices behind it and can trigger repeated spanning-tree recalculations across the building.",
        recommendation: "Reseat or replace the cable/SFP on Gi1/0/12, check the attached device's NIC, then enable err-disable auto-recovery with link-flap detection so a bad transceiver self-isolates instead of churning the network.",
        occurrences: 38, firstSeenDaysAgo: 1, lastSeenHoursAgo: 0 },
      { severity: "high", confidence: "definite", source: "ai", status: "open",
        title: "Unexpected DHCP server responding on the network",
        detail: "A device at 10.30.20.205 is answering DHCP with an off-scope 192.168.8.0/24 lease and itself as gateway and DNS. Clients that accept it lose connectivity or get routed through an untrusted host.",
        recommendation: "Find the MAC on the access-switch bridge table, shut the port, and turn on DHCP snooping for VLAN 20 with the core uplink as the only trusted port.",
        occurrences: 7, firstSeenDaysAgo: 1, lastSeenHoursAgo: 0 },
      { severity: "medium", confidence: "suggestive", source: "ai", status: "open",
        title: "Possible network loop on an access switch",
        detail: "Recurring spanning-tree topology-change notifications from roosevelt-asw-200hall suggest a port repeatedly entering forwarding — often a patch cable bridging two wall jacks, or an unmanaged switch plugged in.",
        recommendation: "Trace the TCN source port; enable PortFast + BPDU guard on edge ports so an accidental loop is shut automatically.",
        occurrences: 5, firstSeenDaysAgo: 2, lastSeenHoursAgo: 1 },
      { severity: "low", confidence: "suggestive", source: "ai", status: "open",
        title: "Unidentified device on the network",
        detail: "A host at 10.30.20.209 responds to discovery but advertises no vendor, hostname, or service NetMon can use to classify it. Worth confirming it's a sanctioned device.",
        recommendation: "Check the switch port it's on (visible on its device page) and physically confirm the endpoint; label it in inventory once identified.",
        occurrences: 3, firstSeenDaysAgo: 2, lastSeenHoursAgo: 1 },
      { severity: "info", confidence: "definite", source: "ai-topology", status: "open",
        title: "New switch discovered via neighbor crawl",
        detail: "NetMon found roosevelt-asw-library (10.30.20.6) by walking LLDP/SNMP neighbors from the core — it wasn't in any manual inventory. It's now stitched into the map.",
        recommendation: "Confirm the switch is expected and add it to your documented inventory.",
        occurrences: 1, firstSeenDaysAgo: 1, lastSeenHoursAgo: 1 },
    ];
  }
  // lincoln-es — the saturated-uplink site
  return [
    { severity: "high", confidence: "definite", source: "ai-topology", status: "open",
      title: "Internet uplink sustained near capacity (~95%)",
      detail: "Lincoln's WAN uplink is averaging about 190 Mbps against a 200 Mbps contracted circuit during the school day — almost no headroom, so testing windows and large downloads will feel slow and time out.",
      recommendation: "Review the contracted rate with the ISP, shift backups/large syncs off-peak, and confirm no single host is monopolizing the circuit.",
      occurrences: 12, firstSeenDaysAgo: 3, lastSeenHoursAgo: 0 },
  ];
}

function aiProseFor(slug: string, schoolName: string): string {
  if (slug === "roosevelt-hs") {
    return [
      `## ${schoolName} — daily network health`,
      "",
      "Posture is **stable with one item to action today.** Discovery is healthy across the core and four access switches, device classification is high-confidence, and the **WAN uplink has comfortable headroom** (~31% of the contracted 1 Gbps).",
      "",
      "The finding to act on is a **flapping access port — GigabitEthernet1/0/12 on roosevelt-core-sw1 — cycling roughly 40 times an hour** with a climbing error count. That repeatedly drops whatever is behind it and can ripple into spanning-tree recalcs. The fix is a cable/SFP swap plus link-flap err-disable so a bad transceiver self-isolates.",
      "",
      "Lower-priority items: an **unexpected DHCP server at 10.30.20.205** (contain via DHCP snooping), signs of a **possible loop** on the 200-hall switch, and one **unidentified endpoint** worth confirming. NetMon also auto-discovered a previously-undocumented library switch while crawling the fabric.",
    ].join("\n");
  }
  return [
    `## ${schoolName} — daily network health`,
    "",
    "Discovery and device classification are healthy. The one thing standing out is **capacity, not faults**: the **internet uplink is riding ~95% of the contracted 200 Mbps** through the instructional day, so the circuit has almost no headroom.",
    "",
    "Utilization is measured against the *contracted* rate (the dashed line on the uplink chart), not the physical port speed — which is why a 1 Gbps switch port can still be a bottleneck at 200 Mbps of paid transport. Worth an ISP conversation or moving large transfers off-peak.",
  ].join("\n");
}

function aiFindingsFor(slug: string): AiFinding[] {
  return issuesFor(slug).map((i) => ({
    severity: i.severity,
    confidence: i.confidence,
    title: i.title,
    detail: i.detail,
    evidence: `demo seed data for ${slug}`,
    recommendation: i.recommendation,
  }));
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

async function resetDemo(): Promise<void> {
  const [d] = await db.select().from(districts).where(eq(districts.slug, DISTRICT_SLUG));
  if (!d) return;
  const schoolRows = await db.select().from(schools).where(eq(schools.districtId, d.id));
  const schoolIds = schoolRows.map((s) => s.id);
  if (schoolIds.length) {
    await db
      .delete(topologySnapshots)
      .where(and(eq(topologySnapshots.scopeType, "school"), inArray(topologySnapshots.scopeId, schoolIds)));
  }
  await db.delete(topologySnapshots).where(and(eq(topologySnapshots.scopeType, "district"), eq(topologySnapshots.scopeId, d.id)));
  await db.delete(ingestedBundles).where(eq(ingestedBundles.districtSlug, DISTRICT_SLUG));
  await db.delete(districts).where(eq(districts.id, d.id));
  console.log(`  reset: removed existing district "${DISTRICT_SLUG}" (${schoolIds.length} schools).`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const reset = args.includes("--reset") || process.env.SEED_DEMO_RESET === "1";
  const keepBundles = args.includes("--keep-bundles") || process.env.SEED_DEMO_KEEP_BUNDLES === "1";
  const force = args.includes("--force") || process.env.SEED_DEMO_ALLOW_PROD === "1";

  const url = process.env.DATABASE_URL ?? "";
  const looksLocal = /@(localhost|127\.0\.0\.1|host\.docker\.internal|postgres)([:/]|$)/.test(url);
  if (!url) {
    console.error("DATABASE_URL is not set. Point it at your LOCAL dev Postgres and retry.");
    process.exit(1);
  }
  if (!looksLocal && !force) {
    console.error(
      `Refusing to seed demo data: DATABASE_URL does not look local.\n  ${url.replace(/:[^:@/]*@/, ":****@")}\n` +
        `This script is for a LOCAL dev database. Re-run with --force (or set SEED_DEMO_ALLOW_PROD=1).`,
    );
    process.exit(1);
  }

  console.log(`Seeding demo district "${DISTRICT_NAME}" (${DISTRICT_SLUG})…`);
  if (reset) await resetDemo();

  // 1) Synthesize + ingest bundles (two crawl samples per school for uplink rates).
  const root = join(tmpdir(), `netmon-demo-bundles-${NOW}`);
  for (const s of SCHOOLS) {
    const baseIn = 5_000_000_000;
    const baseOut = 2_000_000_000;
    const points: BundlePoint[] = [
      { scanId: 1, startedMs: SCAN1_MS, coreInOctets: baseIn, coreOutOctets: baseOut },
      { scanId: 2, startedMs: SCAN2_MS,
        coreInOctets: baseIn + octetsFor(s.uplinkInMbps),
        coreOutOctets: baseOut + octetsFor(s.uplinkOutMbps) },
    ];
    for (const pt of points) {
      const dir = join(root, `${s.slug}-${s.sensor}-scan${pt.scanId}`);
      writeBundle(dir, s, pt);
      const res = await ingestBundle(dir, { force: true });
      console.log(
        `  ingested ${s.slug}/${s.sensor} scan ${pt.scanId}: ` +
          `${res.counts.entities_host} hosts, ${res.counts.entities_switch} switches, ` +
          `${res.counts.host_switch_ports} host-port maps`,
      );
    }
  }

  // Resolve + flag the district.
  const [district] = await db.select().from(districts).where(eq(districts.slug, DISTRICT_SLUG));
  await db.update(districts).set({ name: DISTRICT_NAME, isDemo: true }).where(eq(districts.id, district.id));

  const schoolRows = await db.select().from(schools).where(eq(schools.districtId, district.id));
  const schoolBySlug = new Map(schoolRows.map((s) => [s.slug, s]));

  // Sensor id per school (ingest created one per school: slug "mdf").
  const sensorRows = await db
    .select({ id: sensors.id, schoolId: sensors.schoolId })
    .from(sensors)
    .innerJoin(schools, eq(sensors.schoolId, schools.id))
    .where(eq(schools.districtId, district.id));
  const sensorBySchool = new Map(sensorRows.map((r) => [r.schoolId, r.id]));

  // 2) Patch the demo sensors so they read HEALTHY (recent check-in, on-fleet
  //    version → no "behind"/"never checked in" flags). Match the real fleet's
  //    top SHA so the demo boxes don't show as drifting.
  const realShas = await db
    .select({ sha: sensors.reportedSha, ver: sensors.agentVersion })
    .from(sensors)
    .innerJoin(schools, eq(sensors.schoolId, schools.id))
    .innerJoin(districts, eq(schools.districtId, districts.id))
    .where(eq(districts.isDemo, false));
  const fleetSha = fleetTopSha(realShas.map((r) => r.sha)) ?? "0".repeat(40);
  const fleetVer = realShas.find((r) => r.sha === fleetSha)?.ver ?? realShas.find((r) => r.ver)?.ver ?? "stable";

  for (const s of SCHOOLS) {
    const school = schoolBySlug.get(s.slug);
    if (!school) continue;
    const sensorId = sensorBySchool.get(school.id);
    if (!sensorId) continue;
    await db
      .update(sensors)
      .set({
        lastCheckinAt: date(NOW - 90_000),
        reportedSha: fleetSha,
        reportedChannel: "stable",
        agentVersion: fleetVer,
        lastUpdateStatus: "ok",
        lastUpdateAt: iso(NOW - HOUR),
        reportedConfigVersion: 1,
        localIp: `${s.subnet}.9`,
        iface: "eth0",
        ifaceCidr: s.cidr,
        reportedSnmpEnabled: true,
        reportedSftpEnabled: true,
        reportedHostMetrics: { cpu: 11, mem: 37, disk: 42, os: "Ubuntu 22.04 LTS", uptimeSec: 1_894_000, tempC: 46 },
        reportedMetricsAt: date(NOW - 90_000),
      })
      .where(eq(sensors.id, sensorId));
  }

  // 3) Committed WAN rate + speed/iperf/latency results (direct — not from bundles).
  for (const s of SCHOOLS) {
    const school = schoolBySlug.get(s.slug);
    if (!school) continue;
    const sensorId = sensorBySchool.get(school.id)!;

    await db
      .insert(schoolCommittedRate)
      .values({ schoolId: school.id, committedMbps: s.committedMbps, label: "ISP circuit" })
      .onConflictDoUpdate({ target: schoolCommittedRate.schoolId, set: { committedMbps: s.committedMbps, label: "ISP circuit" } });

    const healthy = s.slug === "roosevelt-hs";
    // Public internet speed test.
    await db.insert(speedtestResults).values({
      sensorId, trigger: "scheduled", provider: "cloudflare",
      downloadMbps: healthy ? 934 : 118, uploadMbps: healthy ? 212 : 24,
      latencyMs: healthy ? 7.4 : 31, jitterMs: healthy ? 1.2 : 6.5, lossPct: healthy ? 0 : 0.4,
      server: "Cloudflare", isp: "Demo ISP", ok: true, startedAt: date(NOW - 40 * 60_000),
    });
    // Internal iperf (validates the LAN/uplink can hit rate) — Roosevelt is the healthy one.
    if (healthy) {
      for (const dir of ["down", "up"] as const) {
        await db.insert(iperfResults).values({
          sensorId, trigger: "scheduled", serverHost: "10.0.0.250", serverPort: 5201,
          protocol: "tcp", direction: dir, durationSec: 10,
          throughputMbps: dir === "down" ? 951 : 944, retransmits: 4, jitterMs: 0.8, lossPct: 0,
          ok: true, startedAt: date(NOW - 35 * 60_000),
        });
      }
    }
    // Latency to internet / gateway / DNS.
    const lat: [string, string, number][] = healthy
      ? [["internet", "1.1.1.1", 8.1], ["gateway", s.gatewayIp, 0.7], ["dns", "8.8.8.8", 9.3]]
      : [["internet", "1.1.1.1", 34], ["gateway", s.gatewayIp, 1.1], ["dns", "8.8.8.8", 28]];
    for (const [label, target, ms] of lat) {
      await db.insert(latencyResults).values({
        sensorId, trigger: "scheduled", label, target,
        latencyMs: ms, jitterMs: healthy ? 0.9 : 5.2, lossPct: healthy ? 0 : 0.3,
        ok: true, startedAt: date(NOW - 30 * 60_000),
      });
    }
  }

  // 4) Issues slate.
  let issueCount = 0;
  for (const s of SCHOOLS) {
    const school = schoolBySlug.get(s.slug);
    if (!school) continue;
    for (const it of issuesFor(s.slug)) {
      await db.insert(issues).values({
        districtId: district.id,
        scopeType: "school",
        scopeId: school.id,
        issueKey: issueKeyFromTitle(it.title),
        severity: it.severity,
        confidence: it.confidence,
        title: it.title,
        detail: it.detail,
        recommendation: it.recommendation,
        status: it.status,
        source: it.source,
        occurrences: it.occurrences,
        missedRuns: 0,
        firstSeenAt: date(NOW - it.firstSeenDaysAgo * DAY),
        lastSeenAt: date(NOW - it.lastSeenHoursAgo * HOUR),
        updatedAt: date(NOW - it.lastSeenHoursAgo * HOUR),
      });
      issueCount++;
    }
  }

  // 5) AI analyses (two providers sharing a runId → side-by-side comparison).
  let aiCount = 0;
  const PROVIDERS = [
    { providerId: "anthropic", model: "claude-opus-4-8" },
    { providerId: "azure-openai", model: "gpt-4o" },
  ];
  for (const s of SCHOOLS) {
    const school = schoolBySlug.get(s.slug);
    if (!school) continue;
    const runId = `demo-${s.slug}-${NOW}`;
    for (const p of PROVIDERS) {
      await db.insert(aiAnalyses).values({
        runId, scopeType: "school", scopeId: school.id, districtId: district.id,
        windowStart: date(NOW - DAY), windowEnd: date(NOW), trigger: "scheduled", kind: "general",
        providerId: p.providerId, model: p.model, status: "ok",
        prose: aiProseFor(s.slug, s.name), findings: aiFindingsFor(s.slug),
        tokensIn: 6400, tokensOut: 1500, costUsd: 0.05, latencyMs: 5100,
        completedAt: date(NOW - 30 * 60_000),
      });
      aiCount++;
    }
  }

  if (!keepBundles) {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
  } else {
    console.log(`  bundle dirs kept at: ${root}`);
  }

  const totalHosts = SCHOOLS.reduce((n, s) => n + s.hosts.length, 0);
  console.log(
    `\nDone. District "${DISTRICT_NAME}" seeded:\n` +
      `  • ${SCHOOLS.length} schools, ${SCHOOLS.length} sensors (healthy), ~${totalHosts} devices\n` +
      `  • ${issueCount} open issues (hero: flapping core port w/ fix)\n` +
      `  • ${aiCount} AI analysis rows; committed-rate + speed/iperf/latency seeded\n` +
      `  • maps, classification, host→switch-port (FDB), uplink samples, health rollup\n\n` +
      `Re-run with --reset (or SEED_DEMO_RESET=1) to rebuild.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("seed-demo failed:", err);
  process.exit(1);
});
