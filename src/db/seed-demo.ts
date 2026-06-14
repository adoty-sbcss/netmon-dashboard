/**
 * Seed (or reset) a fully-populated FAKE district for demos / screenshots / video.
 *
 *   npm run seed:demo                 # create the demo district (idempotent-ish)
 *   npm run seed:demo -- --reset      # wipe the demo district first, then recreate
 *   npm run seed:demo -- --keep-bundles  # leave the generated bundle dirs on disk
 *
 * HOW IT WORKS (hybrid, see the chat that produced this):
 *   1. It SYNTHESIZES extracted NetMon bundle directories on disk (the exact layout
 *      src/ingest/bundle.ts expects) and runs them through the REAL ingest pipeline
 *      (ingestBundle). That produces authentic devices, switch/host entities, the
 *      physical + logical topology maps, device classification, uplink-utilization
 *      samples, and the daily health rollup — all from production code, so it can
 *      never drift out of sync with the schema.
 *   2. It then DIRECTLY SEEDS the `issues` and `ai_analyses` tables, which are NOT
 *      produced from bundles (the sensor's findings.json feeds the time-series
 *      `findings` table; real issues come from the AI reconciler). This is what
 *      gives the demo its open -> acknowledged -> resolved narrative and the
 *      AI-report screen with side-by-side model findings.
 *
 * SAFETY: intended for a LOCAL dev database. Everything it creates lives under the
 * district slug `demo-usd`; --reset only ever touches that district. It will refuse
 * to run against a DATABASE_URL that doesn't look local unless --force is passed.
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
  topologySnapshots,
  ingestedBundles,
  issues,
  aiAnalyses,
} from "./schema";
import type { AiFinding } from "./schema/ai";
import { ingestBundle } from "../ingest/ingest";
import { issueKeyFromTitle } from "../lib/issues/reconcile";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const DISTRICT_SLUG = "demo-usd";
// Clean, realistic name — the amber "Demo" badge (driven by districts.is_demo)
// is what marks it as sample data, so the name itself stays normal-looking.
const DISTRICT_NAME = "Demo Unified School District";

const NOW = Date.now();
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();
const date = (ms: number) => new Date(ms);

// ---------------------------------------------------------------------------
// Tiny deterministic helpers (stable output across runs — nicer for screenshots)
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

// ---------------------------------------------------------------------------
// Device / switch / school specs
// ---------------------------------------------------------------------------

interface HostSpec {
  host: string;
  vendor: string;
  oui: string;
  ip: string; // last octet appended to the school subnet base
  /** mDNS/SSDP hint → strong classifier signal (printer|camera|chromecast|...). */
  serviceHint?: string;
  serviceTypes?: string[];
}

interface SwitchSpec {
  chassis: string; // chassis id (also the entity dedup key)
  name: string;
  descr: string;
  mgmtIp: string;
  /** This switch's uplink toward the core, for the utilization story. */
  uplinkIfindex?: string;
  uplinkSpeed?: number;
  /** Mark a redundant link from this switch as STP-blocked on the map. */
  blockedIfindex?: string;
}

interface SchoolSpec {
  slug: string;
  name: string;
  sensor: string;
  subnet: string; // e.g. "10.20.10" — hosts get .<ip>
  cidr: string; // e.g. "10.20.10.0/24"
  gatewayIp: string;
  gatewayMac: string;
  vlan: number;
  core: SwitchSpec;
  access: SwitchSpec[];
  hosts: HostSpec[];
  /** A second DHCP server seen on the wire = rogue. Drives the critical issue. */
  rogueDhcpIp?: string;
  rogueDhcpMac?: string;
  /** A resolver that rewrites NXDOMAIN (ad-injection / captive filter). */
  nxdomainRewriteResolver?: string;
  /** Inject an STP topology-change event (access ring flap). */
  stpFlapBridge?: string;
  /** Broadcast as a fraction of capture, for the storm narrative. */
  broadcastPct: number;
}

// ---- LINCOLN ELEMENTARY — the mostly-healthy site ----

const LINCOLN: SchoolSpec = {
  slug: "lincoln-es",
  name: "Lincoln Elementary",
  sensor: "mdf",
  subnet: "10.20.10",
  cidr: "10.20.10.0/24",
  gatewayIp: "10.20.10.1",
  gatewayMac: mac("00:1b:17", "lincoln-gw"),
  vlan: 10,
  broadcastPct: 1.2,
  core: {
    chassis: mac("00:1b:54", "lincoln-core"),
    name: "lincoln-core-sw1",
    descr: "Cisco IOS Software, C9300 Software (CAT9K_IOSXE), Version 17.9",
    mgmtIp: "10.20.10.2",
    uplinkIfindex: "49",
    uplinkSpeed: 1000,
  },
  access: [
    {
      chassis: mac("00:1b:54", "lincoln-asw1"),
      name: "lincoln-asw-1",
      descr: "Cisco IOS Software, C9200L Software, Version 17.9",
      mgmtIp: "10.20.10.3",
    },
    {
      chassis: mac("00:1b:54", "lincoln-asw2"),
      name: "lincoln-asw-2",
      descr: "Aruba JL675A 6300M Switch Software, Version 10.10",
      mgmtIp: "10.20.10.4",
    },
  ],
  hosts: [
    { host: "lib-laserjet-01", vendor: "HP Inc.", oui: "3c:52:82", ip: "31",
      serviceHint: "printer", serviceTypes: ["_ipp._tcp.local", "_pdl-datastream._tcp.local"] },
    { host: "office-mfp-canon", vendor: "Canon Inc.", oui: "00:1e:8f", ip: "32",
      serviceHint: "printer", serviceTypes: ["_ipp._tcp.local"] },
    { host: "rm12-appletv", vendor: "Apple, Inc.", oui: "ac:bc:32", ip: "40",
      serviceHint: "apple-av", serviceTypes: ["_airplay._tcp.local", "_raop._tcp.local"] },
    { host: "library-chromecast", vendor: "Google, Inc.", oui: "f4:f5:d8", ip: "41",
      serviceHint: "chromecast", serviceTypes: ["_googlecast._tcp.local"] },
    { host: "promethean-rm8", vendor: "Promethean Limited", oui: "00:23:a7", ip: "45" },
    { host: "ap-bldg-a-1", vendor: "Aruba Networks", oui: "20:4c:03", ip: "11" },
    { host: "ap-bldg-a-2", vendor: "Aruba Networks", oui: "20:4c:03", ip: "12" },
    { host: "ap-bldg-b-1", vendor: "Aruba Networks", oui: "20:4c:03", ip: "13" },
    { host: "axis-cam-frontdoor", vendor: "Axis Communications AB", oui: "ac:cc:8e", ip: "61",
      serviceHint: "camera", serviceTypes: ["_axis-video._tcp.local", "_rtsp._tcp.local"] },
    { host: "axis-cam-playground", vendor: "Axis Communications AB", oui: "ac:cc:8e", ip: "62",
      serviceHint: "camera", serviceTypes: ["_rtsp._tcp.local"] },
    { host: "srv-dc01", vendor: "Dell Inc.", oui: "00:14:22", ip: "20" },
    { host: "synology-nas", vendor: "Synology Incorporated", oui: "00:11:32", ip: "22" },
    { host: "yealink-frontoffice", vendor: "Yealink Network", oui: "80:5e:c0", ip: "70" },
    { host: "pc-lab204-01", vendor: "Dell Inc.", oui: "18:db:f2", ip: "120" },
    { host: "pc-lab204-02", vendor: "Dell Inc.", oui: "18:db:f2", ip: "121" },
    { host: "cb-cart-a-01", vendor: "Google, Inc.", oui: "a4:77:33", ip: "130" },
    { host: "cb-cart-a-02", vendor: "Google, Inc.", oui: "a4:77:33", ip: "131" },
    { host: "cb-cart-a-03", vendor: "Google, Inc.", oui: "a4:77:33", ip: "132" },
    { host: "fw-edge-01", vendor: "Fortinet, Inc.", oui: "00:09:0f", ip: "1" },
  ],
};

// ---- ROOSEVELT HIGH — the problem site (drives the critical/high issues) ----

const ROOSEVELT: SchoolSpec = {
  slug: "roosevelt-hs",
  name: "Roosevelt High School",
  sensor: "mdf",
  subnet: "10.30.20",
  cidr: "10.30.20.0/24",
  gatewayIp: "10.30.20.1",
  gatewayMac: mac("00:1b:17", "roosevelt-gw"),
  vlan: 20,
  broadcastPct: 7.8, // storm
  rogueDhcpIp: "10.30.20.205",
  rogueDhcpMac: mac("b8:27:eb", "roosevelt-rogue"), // Raspberry Pi OUI — classic rogue
  nxdomainRewriteResolver: "10.30.20.1",
  stpFlapBridge: mac("00:1b:54", "roosevelt-asw3"),
  core: {
    chassis: mac("00:1b:54", "roosevelt-core"),
    name: "roosevelt-core-sw1",
    descr: "Cisco IOS Software, C9500 Software (CAT9K), Version 17.12",
    mgmtIp: "10.30.20.2",
    uplinkIfindex: "49",
    uplinkSpeed: 1000, // 1G uplink — saturated in this demo
  },
  access: [
    {
      chassis: mac("00:1b:54", "roosevelt-asw1"),
      name: "roosevelt-asw-1",
      descr: "Cisco IOS Software, C9200L Software, Version 17.9",
      mgmtIp: "10.30.20.3",
    },
    {
      chassis: mac("00:1b:54", "roosevelt-asw2"),
      name: "roosevelt-asw-2",
      descr: "Cisco IOS Software, C9200L Software, Version 17.9",
      mgmtIp: "10.30.20.4",
    },
    {
      chassis: mac("00:1b:54", "roosevelt-asw3"),
      name: "roosevelt-asw-3-gym",
      descr: "Aruba JL678A 6300M Switch Software, Version 10.10",
      mgmtIp: "10.30.20.5",
      blockedIfindex: "50", // redundant gym uplink — STP blocking (shown on the map)
    },
  ],
  hosts: [
    { host: "gym-laserjet-09", vendor: "HP Inc.", oui: "3c:52:82", ip: "33",
      serviceHint: "printer", serviceTypes: ["_ipp._tcp.local"] },
    { host: "admin-mfp-ricoh", vendor: "Ricoh Company", oui: "00:26:73", ip: "34",
      serviceHint: "printer", serviceTypes: ["_ipp._tcp.local", "_printer._tcp.local"] },
    { host: "auditorium-appletv", vendor: "Apple, Inc.", oui: "ac:bc:32", ip: "42",
      serviceHint: "apple-av", serviceTypes: ["_airplay._tcp.local"] },
    { host: "rm210-chromecast", vendor: "Google, Inc.", oui: "f4:f5:d8", ip: "43",
      serviceHint: "chromecast", serviceTypes: ["_googlecast._tcp.local"] },
    { host: "promethean-rm210", vendor: "Promethean Limited", oui: "00:23:a7", ip: "46" },
    { host: "ap-200hall-1", vendor: "Cisco Meraki", oui: "0c:8d:db", ip: "14" },
    { host: "ap-200hall-2", vendor: "Cisco Meraki", oui: "0c:8d:db", ip: "15" },
    { host: "ap-gym-1", vendor: "Cisco Meraki", oui: "0c:8d:db", ip: "16" },
    { host: "ap-library-1", vendor: "Cisco Meraki", oui: "0c:8d:db", ip: "17" },
    { host: "hik-cam-parkinglot", vendor: "Hangzhou Hikvision", oui: "44:19:b6", ip: "63",
      serviceHint: "camera", serviceTypes: ["_rtsp._tcp.local"] },
    { host: "hik-cam-mainhall", vendor: "Hangzhou Hikvision", oui: "44:19:b6", ip: "64",
      serviceHint: "camera", serviceTypes: ["_rtsp._tcp.local"] },
    { host: "srv-app01", vendor: "Dell Inc.", oui: "00:14:22", ip: "20" },
    { host: "srv-sql01", vendor: "Dell Inc.", oui: "00:14:22", ip: "21" },
    { host: "qnap-backup", vendor: "QNAP Systems", oui: "24:5e:be", ip: "23" },
    { host: "yealink-mainoffice", vendor: "Yealink Network", oui: "80:5e:c0", ip: "71" },
    { host: "yealink-counseling", vendor: "Yealink Network", oui: "80:5e:c0", ip: "72" },
    { host: "pc-lab301-01", vendor: "Dell Inc.", oui: "18:db:f2", ip: "140" },
    { host: "pc-lab301-02", vendor: "Dell Inc.", oui: "18:db:f2", ip: "141" },
    { host: "pc-lab301-03", vendor: "Dell Inc.", oui: "18:db:f2", ip: "142" },
    { host: "cb-cart-c-01", vendor: "Google, Inc.", oui: "a4:77:33", ip: "150" },
    { host: "cb-cart-c-02", vendor: "Google, Inc.", oui: "a4:77:33", ip: "151" },
    { host: "rpi-unknown-205", vendor: "Raspberry Pi Foundation", oui: "b8:27:eb", ip: "205" },
    { host: "fw-edge-01", vendor: "Fortinet, Inc.", oui: "00:09:0f", ip: "1" },
  ],
};

const SCHOOLS = [LINCOLN, ROOSEVELT];

// ---------------------------------------------------------------------------
// Bundle synthesis — write one extracted bundle dir for a (school, time) point
// ---------------------------------------------------------------------------

interface BundlePoint {
  scanId: number;
  startedMs: number;
  /** Monotonically increasing uplink octet counters for the rate computation. */
  coreInOctets: number;
  coreOutOctets: number;
}

function deviceCsv(s: SchoolSpec): string {
  const head = "ip,mac,hostname,vendor,source,first_seen_at,last_seen_at";
  const rows = s.hosts.map((h) => {
    const ip = `${s.subnet}.${h.ip}`;
    const m = h.host === "fw-edge-01" ? s.gatewayMac : mac(h.oui, `${s.slug}-${h.host}`);
    return [ip, m, h.host, `"${h.vendor}"`, "arp+nmap", iso(NOW - 6 * DAY), iso(NOW - HOUR)].join(",");
  });
  return [head, ...rows].join("\n") + "\n";
}

function lldpNeighbors(s: SchoolSpec) {
  // The sensor is directly attached to the core — one LLDP neighbor. The rest of
  // the fabric comes from the SNMP crawl (snmp_topology.json).
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
      seen_at: iso(NOW - HOUR),
    },
  ];
}

function dhcpObserved(s: SchoolSpec) {
  const out: Record<string, unknown>[] = [];
  // Legitimate server (the gateway).
  for (let i = 0; i < 6; i++) {
    out.push({
      message_type: i % 2 === 0 ? "DISCOVER" : "ACK",
      server_ip: i % 2 === 0 ? null : s.gatewayIp,
      server_mac: i % 2 === 0 ? null : s.gatewayMac,
      client_mac: mac("18:db:f2", `${s.slug}-dhcpclient-${i}`),
      offered_ip: i % 2 === 0 ? null : `${s.subnet}.${120 + i}`,
      subnet_mask: "255.255.255.0",
      router: s.gatewayIp,
      dns_servers: `${s.gatewayIp}, 8.8.8.8`,
      vendor_class_id: "MSFT 5.0",
      client_hostname: `pc-dhcp-${i}`,
      seen_at: iso(NOW - HOUR + i * 60_000),
    });
  }
  // Rogue server (a 2nd box answering DHCP) — drives the critical issue.
  if (s.rogueDhcpIp) {
    for (let i = 0; i < 3; i++) {
      out.push({
        message_type: "OFFER",
        server_ip: s.rogueDhcpIp,
        server_mac: s.rogueDhcpMac,
        client_mac: mac("18:db:f2", `${s.slug}-victim-${i}`),
        offered_ip: `192.168.8.${50 + i}`, // hands out a DIFFERENT subnet → red flag
        subnet_mask: "255.255.255.0",
        router: s.rogueDhcpIp,
        dns_servers: s.rogueDhcpIp,
        seen_at: iso(NOW - HOUR + 30_000 + i * 45_000),
      });
    }
  }
  return out;
}

function dnsHealth(s: SchoolSpec) {
  const rewrites = !!s.nxdomainRewriteResolver;
  const probes = [
    { resolver_ip: s.gatewayIp, resolver_source: "dhcp", query_name: "www.google.com",
      query_type: "A", expected_status: "NOERROR", status: "NOERROR", query_time_ms: 14,
      answer_count: 1, probed_at: iso(NOW - HOUR) },
    { resolver_ip: s.gatewayIp, resolver_source: "dhcp",
      query_name: "no-such-name-xyzzy.invalid", query_type: "A",
      expected_status: "NXDOMAIN", status: rewrites ? "NOERROR" : "NXDOMAIN",
      query_time_ms: 22, answer_count: rewrites ? 1 : 0,
      answers_text: rewrites ? "10.30.20.1 (block page)" : "", probed_at: iso(NOW - HOUR) },
    { resolver_ip: "8.8.8.8", resolver_source: "static", query_name: "www.cloudflare.com",
      query_type: "A", expected_status: "NOERROR", status: "NOERROR", query_time_ms: 18,
      answer_count: 2, probed_at: iso(NOW - HOUR) },
  ];
  return {
    probe_count: probes.length,
    by_resolver: [
      { resolver_ip: s.gatewayIp, resolver_source: "dhcp", probes: 2, ok: 2, errors: 0,
        nxdomain_rewrite: rewrites, mean_ms: 18 },
      { resolver_ip: "8.8.8.8", resolver_source: "static", probes: 1, ok: 1, errors: 0,
        nxdomain_rewrite: false, mean_ms: 18 },
    ],
    probes,
  };
}

function stpEvents(s: SchoolSpec) {
  if (!s.stpFlapBridge) return [];
  return [
    { bpdu_type: "TCN", root_bridge_id: `32768.${s.core.chassis}`, bridge_id: `32768.${s.stpFlapBridge}`,
      port_id: "128.50", root_path_cost: 8, topology_change: true, seen_at: iso(NOW - 2 * HOUR) },
    { bpdu_type: "Config", root_bridge_id: `32768.${s.core.chassis}`, bridge_id: `32768.${s.stpFlapBridge}`,
      port_id: "128.50", root_path_cost: 8, topology_change: true, seen_at: iso(NOW - 2 * HOUR + 5000) },
  ];
}

function trafficStats(s: SchoolSpec, pt: BundlePoint) {
  const total = 4_200_000;
  const broadcast = Math.round((total * s.broadcastPct) / 100);
  const multicast = Math.round(total * 0.03);
  return [
    {
      interface: "eth0",
      bucket_start: iso(pt.startedMs),
      bucket_end: iso(pt.startedMs + 5 * 60_000),
      rx_packets: total,
      rx_bytes: total * 540,
      rx_errors: s.broadcastPct > 5 ? 1200 : 0,
      rx_dropped: s.broadcastPct > 5 ? 800 : 0,
      tx_packets: Math.round(total * 0.4),
      tx_bytes: total * 200,
      broadcast_packets: broadcast,
      multicast_packets: multicast,
      tshark_total_packets: total,
    },
  ];
}

function snmpPolls(s: SchoolSpec, pt: BundlePoint) {
  // Minimal-but-real SNMP: sys identity per switch so ENTITY/identity enrich works.
  const rows: Record<string, unknown>[] = [];
  const all = [s.core, ...s.access];
  for (const sw of all) {
    rows.push({ device_ip: sw.mgmtIp, oid: "1.3.6.1.2.1.1.5.0", oid_name: "sysName",
      value: sw.name, polled_at: iso(pt.startedMs) });
    rows.push({ device_ip: sw.mgmtIp, oid: "1.3.6.1.2.1.1.1.0", oid_name: "sysDescr",
      value: sw.descr, polled_at: iso(pt.startedMs) });
  }
  return rows;
}

function topologyJson(s: SchoolSpec) {
  // The local LLDP star + host nodes (drives the per-sensor physical star and the
  // logical subnet view). The multi-switch fabric is added by snmp_topology.json.
  const self = "self:eth0";
  const nodes: Record<string, unknown>[] = [
    { id: self, type: "scanner", label: `NetMon (eth0)`, ip: s.cidr },
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
    nodes.push({ id: `host:${ip}`, type: "host", label: h.host, ip, vendor: h.vendor, source: "arp" });
    edges.push({ source: self, target: `host:${ip}`, kind: "l3_seen" });
  }
  return { scan_id: 1, nodes, edges };
}

function snmpTopologyJson(s: SchoolSpec, pt: BundlePoint) {
  const coreIface: Record<string, unknown> = {
    [s.core.uplinkIfindex!]: {
      name: "GigabitEthernet1/0/49", speed_mbps: s.core.uplinkSpeed, oper_status: "up",
      in_errors: 0, out_errors: 0, stp_state: "forwarding",
    },
  };
  const nodes: Record<string, unknown>[] = [
    {
      chassis_id: s.core.chassis, system_name: s.core.name, system_description: s.core.descr,
      mgmt_ips: [s.core.mgmtIp], source: "snmp", capabilities: ["bridge", "router"],
      extra: {
        interfaces: coreIface,
        uplink: {
          ifindex: s.core.uplinkIfindex, name: "GigabitEthernet1/0/49",
          speed_mbps: s.core.uplinkSpeed, in_octets: pt.coreInOctets,
          out_octets: pt.coreOutOctets, counter_ts: Math.floor(pt.startedMs / 1000),
        },
      },
    },
  ];
  const edges: Record<string, unknown>[] = [];
  let port = 1;
  for (const a of s.access) {
    const ifaces: Record<string, unknown> = {};
    if (a.blockedIfindex) {
      ifaces[a.blockedIfindex] = {
        name: `GigabitEthernet1/0/${a.blockedIfindex}`, speed_mbps: 1000,
        oper_status: "up", stp_state: "blocking",
      };
    }
    nodes.push({
      chassis_id: a.chassis, system_name: a.name, system_description: a.descr,
      mgmt_ips: [a.mgmtIp], source: "snmp", capabilities: ["bridge"],
      extra: Object.keys(ifaces).length ? { interfaces: ifaces } : null,
    });
    // Core <-> access link.
    edges.push({
      local_chassis_id: s.core.chassis, local_port_id: String(port),
      local_port_desc: `Gi1/0/${port}`, remote_chassis_id: a.chassis,
      remote_port_id: "49", remote_port_desc: "Gi1/0/49", via: "lldp",
    });
    // The blocked redundant link (asw <-> asw, STP blocking on the local port).
    if (a.blockedIfindex) {
      const other = s.access.find((x) => x !== a);
      if (other) {
        edges.push({
          local_chassis_id: a.chassis, local_port_id: a.blockedIfindex,
          local_port_desc: `Gi1/0/${a.blockedIfindex}`, remote_chassis_id: other.chassis,
          remote_port_id: "50", remote_port_desc: "Gi1/0/50", via: "lldp",
        });
      }
    }
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
    ping_alive: true, ping_rtt_ms: 0.8 + i * 0.3, ping_loss_pct: 0,
    snmp_responded: true, snmp_version: "2c", traceroute_hops: 1 + i,
    traceroute_path: [s.gatewayIp], checked_at: iso(NOW - HOUR),
  }));
}

function serviceDiscovery(s: SchoolSpec) {
  const devices = s.hosts
    .filter((h) => h.serviceHint)
    .map((h) => ({
      ip: `${s.subnet}.${h.ip}`,
      source: "mdns",
      hostname: h.host,
      service_types: h.serviceTypes ?? [],
      device_hint: h.serviceHint,
    }));
  return { devices };
}

function findingsJson(s: SchoolSpec) {
  // Sensor-side rule findings (these feed the time-series `findings` table; the
  // durable Issues list is seeded separately below).
  const out: Record<string, unknown>[] = [];
  if (s.rogueDhcpIp) {
    out.push({
      rule: "dhcp.rogue_server", severity: "critical",
      title: "Multiple DHCP servers answering on this segment",
      detail: `Saw OFFERs from ${s.rogueDhcpIp} (${s.rogueDhcpMac}) handing out 192.168.8.0/24 — not the sanctioned scope.`,
      evidence: { authorized: s.gatewayIp, rogue: s.rogueDhcpIp },
      created_at: iso(NOW - HOUR),
    });
  }
  if (s.nxdomainRewriteResolver) {
    out.push({
      rule: "dns.nxdomain_rewrite", severity: "high",
      title: "Resolver rewrites NXDOMAIN to an answer",
      detail: `Resolver ${s.nxdomainRewriteResolver} returned NOERROR for a guaranteed-bogus name.`,
      evidence: { resolver: s.nxdomainRewriteResolver },
      created_at: iso(NOW - HOUR),
    });
  }
  if (s.broadcastPct > 5) {
    out.push({
      rule: "traffic.broadcast_high", severity: "high",
      title: "Elevated broadcast traffic",
      detail: `Broadcast is ${s.broadcastPct}% of captured packets (warn >5%).`,
      evidence: { broadcast_pct: s.broadcastPct },
      created_at: iso(NOW - HOUR),
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
  resolvedHoursAgo?: number;
  note?: string;
}

function issuesFor(slug: string): IssueSeed[] {
  if (slug === "roosevelt-hs") {
    return [
      { severity: "critical", confidence: "definite", source: "ai", status: "open",
        title: "Rogue DHCP server on VLAN 20",
        detail: "A second device (10.30.20.205, Raspberry Pi Foundation OUI) is answering DHCP and handing clients 192.168.8.0/24 with itself as the gateway and DNS — a man-in-the-middle / outage risk.",
        recommendation: "Locate the MAC on the access switch FDB, shut the port, and enable DHCP snooping on VLAN 20 with the core as the only trusted port.",
        occurrences: 9, firstSeenDaysAgo: 1, lastSeenHoursAgo: 1 },
      { severity: "high", confidence: "definite", source: "ai", status: "open",
        title: "DNS resolver rewriting NXDOMAIN responses",
        detail: "Resolver 10.30.20.1 returned NOERROR with an answer for a guaranteed-nonexistent name, indicating NXDOMAIN rewriting (content filter or ad-injection) that breaks software relying on negative answers.",
        recommendation: "Confirm whether the upstream filter is intentional; if not, disable NXDOMAIN redirection on the FortiGate DNS profile.",
        occurrences: 14, firstSeenDaysAgo: 3, lastSeenHoursAgo: 1 },
      { severity: "high", confidence: "suggestive", source: "ai", status: "acknowledged",
        title: "Sustained broadcast traffic above 5% on VLAN 20",
        detail: "Broadcast is averaging ~7.8% of captured packets with rising RX errors/drops on the sensor uplink — consistent with a loop or a chatty misconfigured host.",
        recommendation: "Check for an STP loop on asw-3 (gym) and look for an unmanaged switch plugged into a wall port.",
        occurrences: 6, firstSeenDaysAgo: 2, lastSeenHoursAgo: 1, note: "Network team investigating gym wing — suspect a daisy-chained switch." },
      { severity: "medium", confidence: "suggestive", source: "ai-topology", status: "open",
        title: "Core uplink Gi1/0/49 averaging over 80% utilization",
        detail: "The 1 Gbps uplink from roosevelt-core-sw1 is sustaining ~850 Mbps inbound during the school day, leaving little headroom for testing windows or backups.",
        recommendation: "Schedule backups off-peak and evaluate a 10G uplink (or LACP bundle) for the core.",
        occurrences: 4, firstSeenDaysAgo: 2, lastSeenHoursAgo: 1 },
      { severity: "medium", confidence: "definite", source: "ai", status: "resolved",
        title: "Spanning-tree topology changes on asw-3-gym",
        detail: "Repeated TCN BPDUs from the gym access switch were flapping a redundant link.",
        recommendation: "Enable PortFast + BPDU guard on edge ports; confirm the redundant uplink is intentional.",
        occurrences: 11, firstSeenDaysAgo: 6, lastSeenHoursAgo: 50, resolvedHoursAgo: 36,
        note: "Auto-resolved: STP stabilized after BPDU guard was enabled and the redundant gym link moved to STP blocking." },
      { severity: "high", confidence: "definite", source: "ai", status: "resolved",
        title: "Switch idf-3 unreachable (no SNMP, no ping)",
        detail: "The gym IDF switch stopped responding to ping and SNMP for ~4 hours.",
        recommendation: "Check PoE budget / power on the IDF; verify the uplink fiber.",
        occurrences: 7, firstSeenDaysAgo: 5, lastSeenHoursAgo: 28, resolvedHoursAgo: 24,
        note: "Resolved by site tech — failed PoE injector replaced; switch back online." },
    ];
  }
  // lincoln-es — mostly healthy
  return [
    { severity: "medium", confidence: "suggestive", source: "ai", status: "open",
      title: "Printer lib-laserjet-01 not responding",
      detail: "The library HP LaserJet (10.20.10.31) stopped answering ping and mDNS in the last two scans, though it was healthy earlier this week.",
      recommendation: "Verify the printer is powered on and check the access-switch port; confirm it pulled a DHCP lease.",
      occurrences: 2, firstSeenDaysAgo: 1, lastSeenHoursAgo: 1 },
    { severity: "low", confidence: "suggestive", source: "ai", status: "resolved",
      title: "Duplicate IP detected in 10.20.10.0/24",
      detail: "Two MACs briefly claimed 10.20.10.45 (a static-assigned Promethean panel and a DHCP client).",
      recommendation: "Exclude statically-assigned addresses from the DHCP scope.",
      occurrences: 3, firstSeenDaysAgo: 4, lastSeenHoursAgo: 72, resolvedHoursAgo: 60,
      note: "Auto-resolved after the DHCP exclusion range was added." },
  ];
}

function aiProseFor(slug: string, schoolName: string): string {
  if (slug === "roosevelt-hs") {
    return [
      `## ${schoolName} — daily network health`,
      "",
      "Overall posture is **degraded** today, driven by one critical and two high-severity findings that are likely related.",
      "",
      "The most urgent item is a **rogue DHCP server at 10.30.20.205** (a Raspberry Pi-class device) handing clients an unauthorized 192.168.8.0/24 scope with itself as gateway and DNS. Any client that accepts that lease is effectively cut off and potentially routed through an untrusted host. This should be contained today via DHCP snooping and a port shut.",
      "",
      "Separately, the **edge resolver (10.30.20.1) is rewriting NXDOMAIN** into positive answers. If that is an intentional content filter it is worth documenting; if not, it will silently break captive-portal detection and a range of client software.",
      "",
      "Capacity-wise, the **core uplink is running near saturation (~850 Mbps on a 1 Gbps link)** during instructional hours, and **broadcast traffic on VLAN 20 is elevated (~7.8%)** with rising interface errors — the latter often points at a loop or an unmanaged switch in the gym wing, which also aligns with the recent (now-resolved) STP flapping on asw-3.",
      "",
      "Two earlier incidents — the gym IDF switch outage and the STP topology changes — have **auto-resolved** and are retained here for history.",
    ].join("\n");
  }
  return [
    `## ${schoolName} — daily network health`,
    "",
    "Posture is **good**. Discovery is stable across two access switches and the core, device classification is high-confidence, and DNS/DHCP look healthy with a single sanctioned server.",
    "",
    "The only open item is the **library LaserJet (10.20.10.31) going quiet** in the last two scans — most likely powered off overnight, worth a quick confirm. An earlier duplicate-IP blip has auto-resolved after a DHCP exclusion was added.",
  ].join("\n");
}

function aiFindingsFor(slug: string): AiFinding[] {
  return issuesFor(slug)
    .filter((i) => i.status !== "resolved")
    .map((i) => ({
      severity: i.severity,
      confidence: i.confidence,
      title: i.title,
      detail: i.detail,
      evidence: `${i.source}: seen ${i.occurrences}x; demo seed data for ${slug}.`,
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

  // topology_snapshots key off scopeId (= school id) with no FK → no cascade.
  if (schoolIds.length) {
    await db
      .delete(topologySnapshots)
      .where(and(eq(topologySnapshots.scopeType, "school"), inArray(topologySnapshots.scopeId, schoolIds)));
  }
  await db.delete(topologySnapshots).where(and(eq(topologySnapshots.scopeType, "district"), eq(topologySnapshots.scopeId, d.id)));

  // ingested_bundles key off slugs (no FK) → no cascade.
  await db.delete(ingestedBundles).where(eq(ingestedBundles.districtSlug, DISTRICT_SLUG));

  // Deleting the district cascades schools/sensors/scan_runs+time-series,
  // entities_*, issues, ai_analyses, health_rollup, topology_positions, uplink_samples.
  await db.delete(districts).where(eq(districts.id, d.id));
  console.log(`  reset: removed existing district "${DISTRICT_SLUG}" (${schoolIds.length} schools).`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  // Env toggles mirror the CLI flags so this can run as an in-Azure Container Apps
  // Job: `az containerapp job start` can't pass leading-dash args (`--force`) and a
  // command-override execution doesn't inherit the job's env, so the in-Azure run
  // re-injects DATABASE_URL via secretref and sets SEED_DEMO_ALLOW_PROD=1 instead.
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
      `Refusing to seed demo data: DATABASE_URL does not look local.\n` +
        `  ${url.replace(/:[^:@/]*@/, ":****@")}\n` +
        `This script is for a LOCAL dev database. Re-run with --force (or set ` +
        `SEED_DEMO_ALLOW_PROD=1) only if you are certain.`,
    );
    process.exit(1);
  }

  console.log(`Seeding demo district "${DISTRICT_NAME}" (${DISTRICT_SLUG})…`);
  if (reset) await resetDemo();

  // 1) Synthesize + ingest bundles (two time points per school for uplink rates).
  const root = join(tmpdir(), `netmon-demo-bundles-${NOW}`);
  for (const s of SCHOOLS) {
    const points: BundlePoint[] = [
      { scanId: 1, startedMs: NOW - 2 * HOUR, coreInOctets: 10_000_000_000, coreOutOctets: 4_000_000_000 },
      // ~850 Mbps in over the 2h gap would be huge; use a realistic 300s window by
      // sampling the second point only 5 min later (the rate is delta/elapsed).
      { scanId: 2, startedMs: NOW - 2 * HOUR + 300_000,
        coreInOctets: 10_000_000_000 + Math.round((850e6 * 300) / 8),
        coreOutOctets: 4_000_000_000 + Math.round((180e6 * 300) / 8) },
    ];
    for (const pt of points) {
      const dir = join(root, `${s.slug}-${s.sensor}-scan${pt.scanId}`);
      writeBundle(dir, s, pt);
      const res = await ingestBundle(dir, { force: true });
      console.log(
        `  ingested ${s.slug}/${s.sensor} scan ${pt.scanId}: ` +
          `${res.counts.entities_host} hosts, ${res.counts.entities_switch} switches, ` +
          `${res.counts.devices} device rows`,
      );
    }
  }

  // Resolve the created district + schools for the direct seeds.
  const [district] = await db.select().from(districts).where(eq(districts.slug, DISTRICT_SLUG));

  // ingest creates the district with name=slug and is_demo=false (the default).
  // Flag it as a demo + give it the friendly name: this is what makes the AI sweep
  // skip it and the maintenance purge spare its time-series (see app.ts isDemo).
  await db
    .update(districts)
    .set({ name: DISTRICT_NAME, isDemo: true })
    .where(eq(districts.id, district.id));

  const schoolRows = await db.select().from(schools).where(eq(schools.districtId, district.id));
  const schoolBySlug = new Map(schoolRows.map((s) => [s.slug, s]));

  // 2) Seed issues per school scope.
  let issueCount = 0;
  for (const s of SCHOOLS) {
    const school = schoolBySlug.get(s.slug);
    if (!school) continue;
    for (const it of issuesFor(s.slug)) {
      const firstSeen = NOW - it.firstSeenDaysAgo * DAY;
      const lastSeen = NOW - it.lastSeenHoursAgo * HOUR;
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
        missedRuns: it.status === "resolved" ? 2 : 0,
        firstSeenAt: date(firstSeen),
        lastSeenAt: date(lastSeen),
        resolvedAt: it.resolvedHoursAgo ? date(NOW - it.resolvedHoursAgo * HOUR) : null,
        acknowledgedAt: it.status === "acknowledged" ? date(NOW - 3 * HOUR) : null,
        note: it.note ?? null,
        updatedAt: date(lastSeen),
      });
      issueCount++;
    }
  }

  // 3) Seed AI analyses per school scope — two providers sharing a runId so the
  //    side-by-side model comparison renders.
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
        runId,
        scopeType: "school",
        scopeId: school.id,
        districtId: district.id,
        windowStart: date(NOW - DAY),
        windowEnd: date(NOW),
        trigger: "scheduled",
        kind: "general",
        providerId: p.providerId,
        model: p.model,
        status: "ok",
        prose: aiProseFor(s.slug, s.name),
        findings: aiFindingsFor(s.slug),
        tokensIn: 6200,
        tokensOut: 1400,
        costUsd: 0.04,
        latencyMs: 5200,
        completedAt: date(NOW - 30 * 60_000),
      });
      aiCount++;
    }
  }

  if (!keepBundles) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  } else {
    console.log(`  bundle dirs kept at: ${root}`);
  }

  console.log(
    `\nDone. District "${DISTRICT_NAME}" seeded:\n` +
      `  • ${SCHOOLS.length} schools, ${SCHOOLS.length} sensors\n` +
      `  • ${issueCount} issues (open / acknowledged / resolved)\n` +
      `  • ${aiCount} AI analysis rows (${PROVIDERS.length} providers × ${SCHOOLS.length} schools)\n` +
      `  • physical + logical maps, device classification, uplink samples, health rollup\n\n` +
      `Sign in and open the "${DISTRICT_NAME}" district to record the demo.\n` +
      `Re-run with --reset to rebuild from scratch.`,
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("seed-demo failed:", err);
  process.exit(1);
});
