/**
 * Ingest one extracted NetMon bundle into the dashboard DB.
 *
 * Idempotent and transactional: re-running the same bundle clears its prior
 * time-series rows (cascade) and rebuilds, while canonical entities and topology
 * are upserts. Identity precedence: CLI override > scan.json slugs > derived from
 * the bundle/folder name (older bundles).
 *
 * What it writes:
 *   tenancy        districts / schools / sensors        (get-or-create)
 *   bookkeeping    ingested_bundles                     (one row per bundle)
 *   time-series    scan_runs + devices/neighbors/dhcp/stp/traffic/snmp/findings
 *   canonical      entities_switch (dedup chassis_id) / entities_host (dedup mac)
 *   maps           topology_snapshots (physical + logical, per school)
 *   rollup         health_rollup_daily (per district+school+day)
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  districts,
  schools,
  sensors,
  ingestedBundles,
  scanRuns,
  devices as devicesTbl,
  neighbors,
  dhcpObservations,
  dnsResolverHealth,
  dnsProbes,
  stpEvents,
  trafficStats,
  snmpPolls,
  hostSwitchPorts,
  findings as findingsTbl,
  networkReachability,
  entitiesSwitch,
  entitiesHost,
  topologySnapshots,
  topologyPositions,
  healthRollupDaily,
  uplinkSamples,
} from "../db/schema";
import {
  readBundleDir,
  collectorFromDirName,
  slugify,
  str,
  toNum,
  toBool,
  toDate,
  type Bundle,
  type ScanData,
  type RawTopology,
  type SnmpInterface,
} from "./bundle";

/** CORE-2: per-ifIndex interface health map carried on a fabric node. */
type RawInterfaces = Record<string, SnmpInterface>;
import { classifyHost } from "../lib/classify";
import { decodeSysObjectId } from "../lib/oui/sysobjectid";
import { isCiscoIpPhoneName, isIpPhoneMapNode, isIpPhoneTopoNode } from "../lib/classify/device-hints";
import { connectPhysicalGraph, type Graph } from "../lib/topology/graph";

/**
 * SNMP curation. Raw SNMP is thousands of rows/scan (mostly ipNetToMediaTable +
 * ifTable bulk). We mirror a priority subset into the hot DB: switch identity
 * (sys*) and everything the per-host switch-port chain needs (FDB, base-port
 * ifindex, ifName, STP port table) is ALWAYS kept; only the bulk tables are
 * capped. The full raw set still lives in the bundle ZIP for later back-extract.
 */
const SNMP_KEEP_OID_NAMES = new Set([
  "sysDescr",
  "sysObjectID",
  "sysName",
  "sysContact",
  "sysLocation",
  "sysUpTime",
  "ifName",
  "dot1dBasePortIfIndex",
  "dot1dTpFdbTable",
  "dot1dStpPortTable",
]);
/**
 * Cap applied only to non-priority bulk rows (ifTable, ipNetToMediaTable,
 * Q-BRIDGE FDB, …). Priority OIDs above are always kept in full. 0 = unlimited
 * (ingest everything). Default is unlimited — override with INGEST_SNMP_BULK_CAP
 * if Postgres growth ever needs reining in.
 */
const SNMP_BULK_ROW_CAP = (() => {
  const raw = process.env.INGEST_SNMP_BULK_CAP;
  if (raw == null || raw === "") return 0; // default: ingest everything
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
})();

/**
 * Max rows per INSERT. A single .values() with tens of thousands of rows (a
 * multi-switch fabric's SNMP dump now that the cap is lifted) overflows both
 * drizzle's query builder ("Maximum call stack size exceeded") and Postgres'
 * 65535 bind-parameter ceiling. Batching keeps every statement well under both.
 */
const INSERT_CHUNK = 500;

/** BRIDGE-MIB / IF-MIB OID prefixes used to derive a host's switch port. */
const FDB_PORT_PREFIX = "1.3.6.1.2.1.17.4.3.1.2."; // dot1dTpFdbPort: suffix=MAC octets, val=bridgePort
const BASEPORT_IFINDEX_PREFIX = "1.3.6.1.2.1.17.1.4.1.2."; // dot1dBasePortIfIndex: suffix=bridgePort, val=ifIndex
const IFNAME_PREFIX = "1.3.6.1.2.1.31.1.1.1.1."; // ifName: suffix=ifIndex, val=name
// ENTITY-MIB (RFC 4133): per-physical-entity inventory. suffix = entPhysicalIndex.
const ENT_CLASS_PREFIX = "1.3.6.1.2.1.47.1.1.1.1.5."; // entPhysicalClass (3 = chassis)
const ENT_SERIAL_PREFIX = "1.3.6.1.2.1.47.1.1.1.1.11."; // entPhysicalSerialNum
const ENT_MODEL_PREFIX = "1.3.6.1.2.1.47.1.1.1.1.13."; // entPhysicalModelName
const SYS_OBJECTID_OID = "1.3.6.1.2.1.1.2.0"; // sysObjectID -> vendor PEN decode

const normOid = (oid?: string | null) => (oid ?? "").replace(/^\./, "");

/** Decimal OID octet suffix [32,207,174,78,233,71] -> "20:cf:ae:4e:e9:47". */
function macFromOctets(octets: number[]): string | null {
  if (octets.length !== 6) return null;
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null;
  return octets.map((o) => o.toString(16).padStart(2, "0")).join(":");
}

interface DerivedPort {
  sourceDeviceIp: string | null;
  mac: string;
  bridgePort: number | null;
  ifIndex: number | null;
  ifName: string | null;
}

/** Furthest-resolved candidate wins when a MAC appears more than once. */
function portRank(d: DerivedPort): number {
  if (d.ifName) return 3;
  if (d.ifIndex != null) return 2;
  return 1;
}

/**
 * Walk the BRIDGE-MIB chain over the FULL SNMP set to map each learned host MAC
 * to a physical switch port: MAC -> dot1dTpFdbPort (bridge port) ->
 * dot1dBasePortIfIndex (ifIndex) -> ifName. Bridge port 0 means "not learned on a
 * specific port" and is skipped. Lookups are keyed per source device so polling
 * multiple switches doesn't cross-contaminate. Returns one row per resolved MAC.
 */
function deriveHostSwitchPorts(snmp: ScanData["snmp"]): DerivedPort[] {
  const basePortIfIndex = new Map<string, number>(); // `${dev}|${bridgePort}` -> ifIndex
  const ifNameByIndex = new Map<string, string>(); // `${dev}|${ifIndex}` -> ifName

  for (const p of snmp) {
    const oid = normOid(p.oid);
    const dev = str(p.device_ip) ?? "";
    if (oid.startsWith(BASEPORT_IFINDEX_PREFIX)) {
      const bp = oid.slice(BASEPORT_IFINDEX_PREFIX.length);
      const ifIndex = toNum(p.value);
      if (bp && ifIndex != null) basePortIfIndex.set(`${dev}|${bp}`, ifIndex);
    } else if (oid.startsWith(IFNAME_PREFIX)) {
      const idx = oid.slice(IFNAME_PREFIX.length);
      const name = (str(p.value) ?? "").replace(/^"|"$/g, "").trim();
      if (idx && name) ifNameByIndex.set(`${dev}|${idx}`, name);
    }
  }

  const byMac = new Map<string, DerivedPort>();
  for (const p of snmp) {
    const oid = normOid(p.oid);
    if (!oid.startsWith(FDB_PORT_PREFIX)) continue;
    const dev = str(p.device_ip) ?? "";
    const octets = oid.slice(FDB_PORT_PREFIX.length).split(".").map(Number);
    const mac = macFromOctets(octets);
    if (!mac) continue;
    const bridgePort = toNum(p.value);
    if (bridgePort == null || bridgePort === 0) continue; // 0 = not learned on a port
    const ifIndex = basePortIfIndex.get(`${dev}|${bridgePort}`) ?? null;
    const ifName =
      ifIndex != null ? (ifNameByIndex.get(`${dev}|${ifIndex}`) ?? null) : null;
    const cand: DerivedPort = {
      sourceDeviceIp: dev || null,
      mac,
      bridgePort,
      ifIndex,
      ifName,
    };
    const existing = byMac.get(mac);
    if (!existing || portRank(cand) > portRank(existing)) byMac.set(mac, cand);
  }
  return [...byMac.values()];
}

/**
 * Pull the chassis serial # + clean model string per device from the ENTITY-MIB
 * (entPhysicalSerialNum / entPhysicalModelName), preferring the chassis entity
 * (entPhysicalClass = 3). Returns device_ip -> { serial?, model? }. Powers real
 * serials + clean models on switch inventory (the collector already bundles these).
 */
function deriveSwitchIdentity(
  snmp: ScanData["snmp"],
): Map<string, { serial?: string; model?: string; vendor?: string }> {
  const clean = (v: string | null): string | undefined => {
    const s = (v ?? "").replace(/^"|"$/g, "").trim();
    return s && s.toLowerCase() !== "null" ? s : undefined;
  };
  // dev -> entPhysicalIndex -> { cls, serial, model }
  const byDev = new Map<string, Map<string, { cls?: string; serial?: string; model?: string }>>();
  const sysoid = new Map<string, string>(); // dev -> sysObjectID value
  const put = (dev: string, idx: string, k: "cls" | "serial" | "model", v: string | undefined) => {
    if (v == null) return;
    let ents = byDev.get(dev);
    if (!ents) { ents = new Map(); byDev.set(dev, ents); }
    const e = ents.get(idx) ?? {};
    e[k] = v;
    ents.set(idx, e);
  };
  for (const p of snmp) {
    const oid = normOid(p.oid);
    const dev = str(p.device_ip) ?? "";
    if (!dev) continue;
    if (oid === SYS_OBJECTID_OID) sysoid.set(dev, str(p.value) ?? "");
    else if (oid.startsWith(ENT_CLASS_PREFIX)) put(dev, oid.slice(ENT_CLASS_PREFIX.length), "cls", clean(str(p.value)));
    else if (oid.startsWith(ENT_SERIAL_PREFIX)) put(dev, oid.slice(ENT_SERIAL_PREFIX.length), "serial", clean(str(p.value)));
    else if (oid.startsWith(ENT_MODEL_PREFIX)) put(dev, oid.slice(ENT_MODEL_PREFIX.length), "model", clean(str(p.value)));
  }
  const out = new Map<string, { serial?: string; model?: string; vendor?: string }>();
  const devs = new Set<string>([...byDev.keys(), ...sysoid.keys()]);
  for (const dev of devs) {
    const ents = byDev.get(dev);
    let best: { cls?: string; serial?: string; model?: string } | undefined;
    if (ents) {
      for (const e of ents.values()) {
        if (!e.serial && !e.model) continue;
        if (e.cls === "3") { best = e; break; } // chassis wins outright
        if (!best) best = e;
      }
    }
    const vendor = decodeSysObjectId(sysoid.get(dev))?.vendor;
    if (best?.serial || best?.model || vendor)
      out.set(dev, { serial: best?.serial, model: best?.model, vendor });
  }
  return out;
}

export interface IdentityOverride {
  district?: string;
  school?: string;
  device?: string;
  force?: boolean;
}

export interface IngestResult {
  bundle: string;
  district: string;
  school: string;
  device: string;
  scans: number;
  counts: Record<string, number>;
  skipped?: boolean;
}

function resolveIdentity(bundle: Bundle, scan: ScanData, ov: IdentityOverride) {
  const district = slugify(
    ov.district || str(scan.meta.district_slug) || "unknown",
  );
  const school = slugify(ov.school || str(scan.meta.school_slug) || "unknown");
  const device = slugify(
    ov.device ||
      str(scan.meta.device_slug) ||
      str(scan.meta.collector) ||
      collectorFromDirName(bundle.dirName) ||
      "unknown",
  );
  return { district, school, device };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function getOrCreateDistrict(tx: Tx, slug: string) {
  await tx
    .insert(districts)
    .values({ slug, name: slug })
    .onConflictDoNothing({ target: districts.slug });
  const [row] = await tx.select().from(districts).where(eq(districts.slug, slug));
  return row;
}

async function getOrCreateSchool(tx: Tx, districtId: number, slug: string) {
  await tx
    .insert(schools)
    .values({ districtId, slug, name: slug })
    .onConflictDoNothing({ target: [schools.districtId, schools.slug] });
  const [row] = await tx
    .select()
    .from(schools)
    .where(and(eq(schools.districtId, districtId), eq(schools.slug, slug)));
  return row;
}

async function getOrCreateSensor(tx: Tx, schoolId: number, slug: string) {
  await tx
    .insert(sensors)
    .values({ schoolId, slug, name: slug })
    .onConflictDoNothing({ target: [sensors.schoolId, sensors.slug] });
  const [row] = await tx
    .select()
    .from(sensors)
    .where(and(eq(sensors.schoolId, schoolId), eq(sensors.slug, slug)));
  return row;
}

function buildPhysicalGraph(
  topo: RawTopology | null,
  sourceScanId: number | null,
  sensorId: number,
) {
  if (!topo) return { nodes: [], edges: [], sourceScanId };
  const keepNode = (t?: string) =>
    t === "scanner" || t === "switch" || t === "gateway";
  const keepEdge = (k?: string) => k === "lldp" || k === "cdp" || k === "default_route";

  // The scanner ("self") node is per-sensor — namespace its id so two sensors at
  // one school (e.g. both on "eth0") don't collapse into a single box. Switches
  // (chassis) and the gateway keep their natural ids so they DEDUP across sensors,
  // which is what stitches the two stars into one connected graph.
  const remap = new Map<string, string>();
  const nodes = (topo.nodes ?? [])
    .filter((n) => keepNode(n.type) && !isIpPhoneMapNode(n))
    .map((n) => {
      if (n.type === "scanner") {
        const newId = `${n.id}#s${sensorId}`;
        remap.set(n.id, newId);
        return { ...n, id: newId };
      }
      return n;
    });
  const ids = new Set(nodes.map((n) => n.id));
  const edges = (topo.edges ?? [])
    .map((e) => ({
      ...e,
      source: remap.get(e.source) ?? e.source,
      target: remap.get(e.target) ?? e.target,
    }))
    .filter((e) => keepEdge(e.kind) && ids.has(e.source) && ids.has(e.target));
  return { nodes, edges, sourceScanId };
}

/** A topology graph as stored in topology_snapshots.graph (jsonb). */
type TopoGraph = {
  nodes: { id: string; [k: string]: unknown }[];
  edges: { source: string; target: string; kind?: string | null; [k: string]: unknown }[];
  sourceScanId?: number | null;
};

/**
 * Union-merge a freshly-built graph into the school's existing snapshot so
 * multiple sensors at one school accumulate into ONE map. Nodes dedup by id
 * (new wins → fresh data; shared switches collapse), edges dedup by
 * source|target|kind. NOTE: this never removes nodes a sensor stops seeing —
 * stale entries linger until superseded by the same id (cleanup is a follow-up).
 */
function mergeTopoGraphs(existing: TopoGraph | null, incoming: TopoGraph): TopoGraph {
  const nodeById = new Map<string, TopoGraph["nodes"][number]>();
  for (const n of existing?.nodes ?? []) nodeById.set(n.id, n);
  for (const n of incoming.nodes) nodeById.set(n.id, n);
  const edgeKey = (e: TopoGraph["edges"][number]) =>
    `${e.source}|${e.target}|${e.kind ?? ""}`;
  const edgeByKey = new Map<string, TopoGraph["edges"][number]>();
  for (const e of existing?.edges ?? []) edgeByKey.set(edgeKey(e), e);
  for (const e of incoming.edges) edgeByKey.set(edgeKey(e), e);
  return {
    nodes: [...nodeById.values()],
    edges: [...edgeByKey.values()],
    sourceScanId: incoming.sourceScanId ?? null,
  };
}

// Placeholder/gateway reconciliation + edge anchoring + island bridging now lives
// in ../lib/topology/graph.ts (connectPhysicalGraph), shared with the validator.

/**
 * Build a physical-graph contribution from the SNMP fabric crawl across ALL
 * scans in the bundle. Switch nodes are keyed `switch:<chassis_id>` — the SAME
 * scheme buildPhysicalGraph() uses for LLDP neighbors — so crawl-discovered
 * switches DEDUP with (and enrich) the directly-attached ones when merged. This
 * is what turns the local LLDP star into the full multi-switch fabric on the map.
 */
function buildSnmpFabricGraph(scans: ScanData[], sourceScanId: number | null): TopoGraph {
  const nodeById = new Map<string, TopoGraph["nodes"][number]>();
  const edgeByKey = new Map<string, TopoGraph["edges"][number]>();
  for (const scan of scans) {
    const topo = scan.snmpTopology;
    if (!topo) continue;
    for (const n of topo.nodes ?? []) {
      const chassis = str(n.chassis_id);
      if (!chassis) continue;
      if (isIpPhoneTopoNode(n)) continue; // Cisco IP phones crawl as fake switches
      const id = `switch:${chassis}`;
      const ifaces = n.extra?.interfaces ?? null; // CORE-2: ifXTable + STP per ifIndex
      const existing = nodeById.get(id);
      nodeById.set(id, {
        id,
        type: "switch",
        label: str(n.system_name) ?? chassis,
        description: str(n.system_description),
        mgmt_ip: (n.mgmt_ips && str(n.mgmt_ips[0])) ?? null,
        source: str(n.source) ?? "snmp",
        capabilities: n.capabilities ?? null,
        // Keep interface data from whichever scan actually polled this switch.
        interfaces: ifaces ?? (existing?.interfaces as RawInterfaces | undefined) ?? null,
      });
    }
    for (const e of topo.edges ?? []) {
      const a = str(e.local_chassis_id);
      const b = str(e.remote_chassis_id);
      if (!a || !b) continue;
      if (isCiscoIpPhoneName(a) || isCiscoIpPhoneName(b)) continue; // drop phone edges
      const source = `switch:${a}`;
      const target = `switch:${b}`;
      const kind = str(e.via) ?? "lldp";
      edgeByKey.set(`${source}|${target}|${kind}`, {
        source,
        target,
        kind,
        local_port: str(e.local_port_id) ?? str(e.local_port_desc),
        remote_port: str(e.remote_port_id) ?? str(e.remote_port_desc),
        // Stash the local ifIndex so the post-pass can join to interface health.
        local_ifindex: str(e.local_port_id),
      });
    }
  }
  // MAP-3/MAP-4 post-pass: now that every node's interfaces are merged, join each
  // edge to its LOCAL port's health → mark blocked STP links + carry link speed.
  for (const e of edgeByKey.values()) {
    const ifidx = e.local_ifindex as string | null | undefined;
    const ifaces = nodeById.get(e.source as string)?.interfaces as RawInterfaces | null | undefined;
    const li = ifidx && ifaces ? ifaces[ifidx] : undefined;
    if (li) {
      if (li.stp_state === "blocking") e.stp_blocked = true;
      if (typeof li.speed_mbps === "number") e.speed_mbps = li.speed_mbps;
    }
  }
  return { nodes: [...nodeById.values()], edges: [...edgeByKey.values()], sourceScanId };
}

/** PERF-3: average Mbps from an octet counter delta, or null when not derivable
 * (missing counter, or a negative delta = counter reset/wrap). */
function uplinkRateMbps(
  prevOctets: number | null,
  curOctets: number | null,
  secs: number,
): number | null {
  if (prevOctets == null || curOctets == null) return null;
  const deltaBytes = curOctets - prevOctets;
  if (deltaBytes < 0) return null; // counter reset/reboot/wrap → skip this interval
  return (deltaBytes * 8) / secs / 1_000_000;
}

/**
 * PERF-3: persist the uplink octet-counter samples carried in this bundle's SNMP
 * crawl (node.extra.uplink), one row per uplink, computing in/out Mbps vs the
 * previous stored sample for the same (school, chassis, ifindex). Best-effort —
 * an hourly bundle may roll up several crawls, so we keep the LATEST sample per
 * uplink and skip anything not newer than what's already stored.
 */
async function persistUplinkSamples(
  tx: Tx,
  schoolId: number,
  sensorId: number,
  scans: ScanData[],
): Promise<void> {
  type Sample = {
    chassisId: string;
    ifindex: string;
    ifName: string | null;
    speedMbps: number | null;
    inOctets: number | null;
    outOctets: number | null;
    sampledAt: Date;
  };
  const latest = new Map<string, Sample>();
  for (const scan of scans) {
    for (const n of scan.snmpTopology?.nodes ?? []) {
      const chassis = str(n.chassis_id);
      const up = n.extra?.uplink;
      if (!chassis || !up) continue;
      const ifindex = up.ifindex != null ? String(up.ifindex) : null;
      const tsSec = typeof up.counter_ts === "number" ? up.counter_ts : null;
      if (!ifindex || tsSec == null) continue;
      const inOctets = typeof up.in_octets === "number" ? up.in_octets : null;
      const outOctets = typeof up.out_octets === "number" ? up.out_octets : null;
      if (inOctets == null && outOctets == null) continue;
      const sampledAt = new Date(tsSec * 1000);
      const key = `${chassis}|${ifindex}`;
      const prev = latest.get(key);
      if (!prev || sampledAt > prev.sampledAt) {
        latest.set(key, {
          chassisId: chassis,
          ifindex,
          ifName: str(up.name),
          speedMbps: typeof up.speed_mbps === "number" ? up.speed_mbps : null,
          inOctets,
          outOctets,
          sampledAt,
        });
      }
    }
  }
  if (latest.size === 0) return;

  for (const s of latest.values()) {
    const [prev] = await tx
      .select({
        inOctets: uplinkSamples.inOctets,
        outOctets: uplinkSamples.outOctets,
        sampledAt: uplinkSamples.sampledAt,
      })
      .from(uplinkSamples)
      .where(
        and(
          eq(uplinkSamples.schoolId, schoolId),
          eq(uplinkSamples.chassisId, s.chassisId),
          eq(uplinkSamples.ifindex, s.ifindex),
        ),
      )
      .orderBy(desc(uplinkSamples.sampledAt))
      .limit(1);

    // Re-ingest / out-of-order guard: never store a sample not newer than the
    // last one for this uplink (keeps the series monotonic + idempotent).
    if (prev?.sampledAt && s.sampledAt.getTime() <= prev.sampledAt.getTime()) {
      continue;
    }

    let inMbps: number | null = null;
    let outMbps: number | null = null;
    if (prev?.sampledAt) {
      const secs = (s.sampledAt.getTime() - prev.sampledAt.getTime()) / 1000;
      // Sane gap only: >30s avoids divide-by-noise; <6h avoids a misleading
      // "average" across a long collection outage.
      if (secs > 30 && secs < 6 * 3600) {
        inMbps = uplinkRateMbps(prev.inOctets, s.inOctets, secs);
        outMbps = uplinkRateMbps(prev.outOctets, s.outOctets, secs);
      }
    }

    await tx.insert(uplinkSamples).values({
      schoolId,
      sensorId,
      chassisId: s.chassisId,
      ifindex: s.ifindex,
      ifName: s.ifName,
      speedMbps: s.speedMbps,
      inOctets: s.inOctets,
      outOctets: s.outOctets,
      inMbps,
      outMbps,
      sampledAt: s.sampledAt,
    });
  }
}

function buildLogicalGraph(scan: ScanData, sourceScanId: number | null) {
  // Group host nodes into /24-ish subnets; attach the gateway. A first-cut
  // logical view — VLAN-aware grouping is a later enhancement.
  const topo = scan.topology;
  const subnetOf = (ip?: string | null) => {
    if (!ip) return null;
    const m = ip.split("/")[0].match(/^(\d+)\.(\d+)\.(\d+)\./);
    return m ? `${m[1]}.${m[2]}.${m[3]}.0/24` : null;
  };
  const counts = new Map<string, number>();
  for (const n of topo?.nodes ?? []) {
    if (n.type !== "host") continue;
    const s = subnetOf(n.ip);
    if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const gatewayIp = str(scan.meta.gateway_ip);
  const nodes = [
    ...(gatewayIp
      ? [{ id: `gw:${gatewayIp}`, type: "gateway", label: `gateway ${gatewayIp}`, ip: gatewayIp }]
      : []),
    ...[...counts.entries()].map(([subnet, hostCount]) => ({
      id: `subnet:${subnet}`,
      type: "subnet",
      label: subnet,
      hostCount,
    })),
  ];
  const edges = gatewayIp
    ? [...counts.keys()].map((subnet) => ({
        source: `subnet:${subnet}`,
        target: `gw:${gatewayIp}`,
        kind: "routes_via",
      }))
    : [];
  return { nodes, edges, sourceScanId };
}

export async function ingestBundle(
  dir: string,
  ov: IdentityOverride = {},
): Promise<IngestResult> {
  const bundle = readBundleDir(dir);
  if (bundle.scans.length === 0) {
    throw new Error(`No scans/ found in bundle dir: ${dir}`);
  }

  const ident = resolveIdentity(bundle, bundle.scans[0], ov);
  const counts: Record<string, number> = {
    scan_runs: 0,
    devices: 0,
    neighbors: 0,
    dhcp_observations: 0,
    stp_events: 0,
    traffic_stats: 0,
    dns_resolver_health: 0,
    dns_probes: 0,
    snmp_polls: 0,
    host_switch_ports: 0,
    findings: 0,
    network_reachability: 0,
    entities_switch: 0,
    entities_host: 0,
  };

  const result = await db.transaction(async (tx) => {
    const district = await getOrCreateDistrict(tx, ident.district);
    const school = await getOrCreateSchool(tx, district.id, ident.school);
    const sensor = await getOrCreateSensor(tx, school.id, ident.device);

    // ---- bundle bookkeeping (idempotent on filename) ----
    const builtAt = bundle.scans
      .map((s) => toDate(s.meta.completed_at))
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    // ING-1: dedup on TENANCY + filename, not bare filename — many sites share a
    // device slug (mdf/idf), so identical filenames across districts must not be
    // treated as the same bundle.
    const [existing] = await tx
      .select()
      .from(ingestedBundles)
      .where(
        and(
          eq(ingestedBundles.districtSlug, ident.district),
          eq(ingestedBundles.schoolSlug, ident.school),
          eq(ingestedBundles.deviceSlug, ident.device),
          eq(ingestedBundles.filename, bundle.filename),
        ),
      );

    if (existing && existing.parseStatus === "parsed" && !ov.force) {
      return { skipped: true } as const;
    }

    let bundleId: number;
    const bundleValues = {
      filename: bundle.filename,
      districtSlug: ident.district,
      schoolSlug: ident.school,
      deviceSlug: ident.device,
      builtAt,
      parsedAt: new Date(),
      parseStatus: "parsed" as const,
      parseError: null,
    };
    if (existing) {
      // Clear prior time-series for a clean re-ingest (cascade hits children).
      await tx.delete(scanRuns).where(eq(scanRuns.bundleId, existing.id));
      await tx
        .update(ingestedBundles)
        .set(bundleValues)
        .where(eq(ingestedBundles.id, existing.id));
      bundleId = existing.id;
    } else {
      const [b] = await tx
        .insert(ingestedBundles)
        .values(bundleValues)
        .returning({ id: ingestedBundles.id });
      bundleId = b.id;
    }

    // ---- per-scan time-series + canonical entities ----
    let healthFindings = 0;
    let healthDhcp = 0;
    let healthStp = 0;
    let healthDns = 0;
    const macSeen = new Set<string>();
    const chassisSeen = new Set<string>();
    // MAC → DHCP fingerprint (hostname + option 60/55), accumulated across all
    // scans in the bundle, used to name + classify SNMP-silent endpoints.
    const dhcpFp = new Map<
      string,
      { hostname?: string | null; vendorClass?: string | null; paramList?: string | null }
    >();
    // IP → mDNS/SSDP service discovery (device hint + advertised service types),
    // accumulated across the bundle's scans. Responders are IP-keyed (no MAC); we
    // match them to a host entity by IP at upsert. Strong signal for the chatty
    // endpoints (AirPrint, Chromecast, cameras) that never speak SNMP.
    const serviceByIp = new Map<
      string,
      { hint: string | null; services: string[] | null; source: string | null }
    >();
    let day: string | null = null;

    for (const scan of bundle.scans) {
      const startedAt = toDate(scan.meta.started_at);
      const completedAt = toDate(scan.meta.completed_at);
      if (completedAt && !day) {
        day = completedAt.toISOString().slice(0, 10);
      }

      const [run] = await tx
        .insert(scanRuns)
        .values({
          sensorId: sensor.id,
          bundleId,
          sourceScanId: toNum(scan.meta.id),
          districtSlug: ident.district,
          schoolSlug: ident.school,
          deviceSlug: ident.device,
          startedAt,
          completedAt,
          triggerReason: str(scan.meta.trigger_reason),
          interface: str(scan.meta.interface),
          interfaceCidr: str(scan.meta.interface_cidr),
          gatewayIp: str(scan.meta.gateway_ip),
          gatewayMac: str(scan.meta.gateway_mac),
          networkId: str(scan.meta.network_id),
          durationSec: toNum(scan.meta.duration_sec),
          isPrimary: toBool(scan.meta.is_primary) ?? bundle.scans.length === 1,
          notes: str(scan.meta.notes),
          error: str(scan.meta.error),
        })
        .returning({ id: scanRuns.id });
      const scanRunId = run.id;
      counts.scan_runs++;

      // devices.csv
      const deviceRows = scan.devices.map((d) => ({
        scanRunId,
        ip: str(d.ip),
        mac: str(d.mac),
        hostname: str(d.hostname),
        vendor: str(d.vendor),
        source: str(d.source),
        firstSeenAt: toDate(d.first_seen_at),
        lastSeenAt: toDate(d.last_seen_at),
      }));
      if (deviceRows.length) {
        await tx.insert(devicesTbl).values(deviceRows);
        counts.devices += deviceRows.length;
      }

      // lldp/cdp neighbors
      const neighborRows = scan.lldp.map((n) => ({
        scanRunId,
        localPort: str(n.local_port),
        protocol: str(n.protocol),
        chassisId: str(n.chassis_id),
        portId: str(n.port_id),
        systemName: str(n.system_name),
        systemDescription: str(n.system_description),
        portDescription: str(n.port_description),
        vlanId: toNum(n.vlan_id),
        mgmtIp: str(n.mgmt_ip),
        capabilities: n.capabilities ?? null,
        seenAt: toDate(n.seen_at),
        extra: (n.extra ?? {}) as object,
      }));
      if (neighborRows.length) {
        await tx.insert(neighbors).values(neighborRows);
        counts.neighbors += neighborRows.length;
      }

      // dhcp
      const dhcpRows = scan.dhcp.map((d) => ({
        scanRunId,
        messageType: str(d.message_type),
        serverIp: str(d.server_ip),
        serverMac: str(d.server_mac),
        clientMac: str(d.client_mac),
        offeredIp: str(d.offered_ip),
        subnetMask: str(d.subnet_mask),
        router: str(d.router),
        dnsServers: str(d.dns_servers),
        seenAt: toDate(d.seen_at),
        vendorClassId: str(d.vendor_class_id),
        paramReqList: str(d.param_req_list),
        clientHostname: str(d.client_hostname),
      }));
      if (dhcpRows.length) {
        await tx.insert(dhcpObservations).values(dhcpRows);
        counts.dhcp_observations += dhcpRows.length;
        healthDhcp += dhcpRows.length;
      }
      // Build a MAC → DHCP fingerprint map (hostname + option 60/55) for this
      // scan, so the canonical host upsert below can name + classify endpoints
      // that never speak SNMP. Lowercased MAC keys.
      for (const d of scan.dhcp) {
        const mac = str(d.client_mac)?.toLowerCase();
        if (!mac) continue;
        const fp = dhcpFp.get(mac) ?? {};
        if (!fp.hostname && d.client_hostname) fp.hostname = str(d.client_hostname);
        if (!fp.vendorClass && d.vendor_class_id) fp.vendorClass = str(d.vendor_class_id);
        if (!fp.paramList && d.param_req_list) fp.paramList = str(d.param_req_list);
        dhcpFp.set(mac, fp);
      }

      // Accumulate mDNS/SSDP responders for this scan, keyed by IP. Union the
      // service types and keep the first non-null hint/source seen for an IP.
      for (const sd of scan.serviceDiscovery) {
        const ip = str(sd.ip);
        if (!ip) continue;
        const prev = serviceByIp.get(ip);
        const merged = new Set([...(prev?.services ?? []), ...(sd.service_types ?? []).map(String)]);
        serviceByIp.set(ip, {
          hint: prev?.hint ?? str(sd.device_hint),
          services: merged.size ? [...merged] : null,
          source: prev?.source ?? str(sd.source),
        });
      }

      // dns health (per-resolver aggregate + per-probe detail)
      const dnsResolverRows = (scan.dns.by_resolver ?? []).map((r) => ({
        scanRunId,
        resolverIp: str(r.resolver_ip),
        resolverSource: str(r.resolver_source),
        probes: toNum(r.probes),
        ok: toNum(r.ok),
        errors: toNum(r.errors),
        nxdomainRewrite: toBool(r.nxdomain_rewrite),
        meanMs: toNum(r.mean_ms),
      }));
      if (dnsResolverRows.length) {
        await tx.insert(dnsResolverHealth).values(dnsResolverRows);
        counts.dns_resolver_health += dnsResolverRows.length;
      }

      const dnsProbeRows = (scan.dns.probes ?? []).map((p) => ({
        scanRunId,
        resolverIp: str(p.resolver_ip),
        resolverSource: str(p.resolver_source),
        queryName: str(p.query_name),
        queryType: str(p.query_type),
        expectedStatus: str(p.expected_status),
        status: str(p.status),
        queryTimeMs: toNum(p.query_time_ms),
        answerCount: toNum(p.answer_count),
        answersText: str(p.answers_text),
        error: str(p.error),
        probedAt: toDate(p.probed_at),
      }));
      if (dnsProbeRows.length) {
        await tx.insert(dnsProbes).values(dnsProbeRows);
        counts.dns_probes += dnsProbeRows.length;
        healthDns += dnsProbeRows.length;
      }

      // stp
      const stpRows = scan.stp.map((s) => ({
        scanRunId,
        bpduType: str(s.bpdu_type),
        rootBridgeId: str(s.root_bridge_id),
        bridgeId: str(s.bridge_id),
        portId: str(s.port_id),
        rootPathCost: toNum(s.root_path_cost),
        topologyChange: toBool(s.topology_change),
        seenAt: toDate(s.seen_at),
      }));
      if (stpRows.length) {
        await tx.insert(stpEvents).values(stpRows);
        counts.stp_events += stpRows.length;
        healthStp += stpRows.length;
      }

      // traffic
      const trafficRows = scan.traffic.map((t) => ({
        scanRunId,
        interface: str(t.interface),
        bucketStart: toDate(t.bucket_start),
        bucketEnd: toDate(t.bucket_end),
        rxPackets: toNum(t.rx_packets),
        rxBytes: toNum(t.rx_bytes),
        rxErrors: toNum(t.rx_errors),
        rxDropped: toNum(t.rx_dropped),
        txPackets: toNum(t.tx_packets),
        txBytes: toNum(t.tx_bytes),
        broadcastPackets: toNum(t.broadcast_packets),
        multicastPackets: toNum(t.multicast_packets),
        tsharkTotalPackets: toNum(t.tshark_total_packets),
      }));
      if (trafficRows.length) {
        await tx.insert(trafficStats).values(trafficRows);
        counts.traffic_stats += trafficRows.length;
      }

      // snmp (curated: keep priority OIDs in full, cap only the bulk tables)
      const keptSnmp: typeof scan.snmp = [];
      const bulkSnmp: typeof scan.snmp = [];
      for (const p of scan.snmp) {
        if (SNMP_KEEP_OID_NAMES.has(str(p.oid_name) ?? "")) keptSnmp.push(p);
        else bulkSnmp.push(p);
      }
      const snmpSlice =
        SNMP_BULK_ROW_CAP > 0
          ? [...keptSnmp, ...bulkSnmp.slice(0, SNMP_BULK_ROW_CAP)]
          : [...keptSnmp, ...bulkSnmp];
      const snmpRows = snmpSlice.map((p) => ({
        scanRunId,
        deviceIp: str(p.device_ip),
        oid: str(p.oid),
        oidName: str(p.oid_name),
        value: str(p.value),
        polledAt: toDate(p.polled_at),
      }));
      if (snmpRows.length) {
        for (let i = 0; i < snmpRows.length; i += INSERT_CHUNK) {
          await tx.insert(snmpPolls).values(snmpRows.slice(i, i + INSERT_CHUNK));
        }
        counts.snmp_polls += snmpRows.length;
      }

      // per-host switch port (derived from the FULL snmp set, not the curated slice)
      const portRows = deriveHostSwitchPorts(scan.snmp).map((d) => ({
        scanRunId,
        sourceDeviceIp: d.sourceDeviceIp,
        mac: d.mac,
        bridgePort: d.bridgePort,
        ifIndex: d.ifIndex,
        ifName: d.ifName,
      }));
      if (portRows.length) {
        for (let i = 0; i < portRows.length; i += INSERT_CHUNK) {
          await tx.insert(hostSwitchPorts).values(portRows.slice(i, i + INSERT_CHUNK));
        }
        counts.host_switch_ports += portRows.length;
      }

      // findings
      const findingRows = scan.findings.map((f) => ({
        scanRunId,
        rule: str(f.rule) ?? "unknown",
        severity: str(f.severity) ?? "info",
        title: str(f.title) ?? str(f.rule) ?? "finding",
        detail: str(f.detail) ?? str(f.message),
        evidence:
          f.evidence && typeof f.evidence === "object"
            ? (f.evidence as object)
            : (f as object),
        createdAt: toDate(f.created_at),
      }));
      if (findingRows.length) {
        await tx.insert(findingsTbl).values(findingRows);
        counts.findings += findingRows.length;
        healthFindings += findingRows.length;
      }

      // network reachability (ping + SNMP-response + traceroute, per candidate)
      const reachRows = scan.reachability.map((r) => ({
        scanRunId,
        ip: str(r.ip),
        hostname: str(r.hostname),
        vendor: str(r.vendor),
        source: str(r.source),
        pingAlive: toBool(r.ping_alive),
        pingRttMs: toNum(r.ping_rtt_ms),
        pingLossPct: toNum(r.ping_loss_pct),
        snmpResponded: toBool(r.snmp_responded),
        snmpVersion: str(r.snmp_version),
        tracerouteHops: toNum(r.traceroute_hops),
        traceroutePath: Array.isArray(r.traceroute_path) ? r.traceroute_path : [],
        checkedAt: toDate(r.checked_at),
      }));
      if (reachRows.length) {
        await tx.insert(networkReachability).values(reachRows);
        counts.network_reachability += reachRows.length;
      }

      // ---- canonical switches (dedup on chassis_id within district) ----
      for (const n of scan.lldp) {
        const chassis = str(n.chassis_id);
        if (!chassis) continue;
        const seen = toDate(n.seen_at) ?? completedAt;
        await tx
          .insert(entitiesSwitch)
          .values({
            districtId: district.id,
            schoolId: school.id,
            chassisId: chassis,
            systemName: str(n.system_name),
            systemDescription: str(n.system_description),
            mgmtIp: str(n.mgmt_ip),
            capabilities: n.capabilities ?? null,
            firstSeenAt: seen,
            lastSeenAt: seen,
          })
          .onConflictDoUpdate({
            target: [entitiesSwitch.districtId, entitiesSwitch.chassisId],
            set: {
              schoolId: school.id,
              systemName: str(n.system_name),
              systemDescription: str(n.system_description),
              mgmtIp: str(n.mgmt_ip),
              capabilities: n.capabilities ?? null,
              lastSeenAt: seen,
              updatedAt: new Date(),
            },
          });
        if (!chassisSeen.has(chassis)) {
          chassisSeen.add(chassis);
          counts.entities_switch++;
        }
      }

      // The scan's gateway — a host matching this ip/mac is the L3 edge (router/fw).
      const gwIp = str(scan.meta.gateway_ip);
      const gwMac = str(scan.meta.gateway_mac)?.toLowerCase() ?? null;

      // ---- canonical hosts (dedup on mac within district) ----
      for (const d of scan.devices) {
        const mac = str(d.mac);
        if (!mac) continue; // need a MAC to dedup
        const seen = toDate(d.last_seen_at) ?? completedAt;
        const fp = dhcpFp.get(mac.toLowerCase());
        const ip = str(d.ip);
        // Prefer the discovered hostname; fall back to the name the client
        // advertised over DHCP (option 12) when PTR/nmap gave us nothing.
        const hostname = str(d.hostname) ?? fp?.hostname ?? null;
        // mDNS/SSDP service hint + raw service types — the strongest signal for
        // chatty endpoints. Prefer the dedicated service_discovery.json (matched
        // by IP) and fall back to any inline 'extra' the collector attached.
        const extra = ((d.extra ?? {}) as unknown) as Record<string, unknown>;
        const svc = ip ? serviceByIp.get(ip) : undefined;
        const serviceHint = svc?.hint ?? str(extra.service_hint);
        const services =
          svc?.services ?? (Array.isArray(extra.services) ? extra.services.map(String) : null);
        const isGateway = (!!gwMac && mac.toLowerCase() === gwMac) || (!!gwIp && ip === gwIp);
        // Enrich: fill manufacturer from the OUI registry when the bundle says
        // "unknown"/blank, and classify device type from mDNS + SNMP + DHCP
        // fingerprint + hostname + vendor + gateway. Pure/offline.
        const cls = classifyHost({
          mac,
          vendor: str(d.vendor),
          hostname,
          dhcpVendorClass: fp?.vendorClass ?? null,
          dhcpParamList: fp?.paramList ?? null,
          serviceHint,
          services,
          isGateway,
        });
        // Persist the service signal so the enrich backfill + AI adjudicator + UI
        // can reuse it (merged into attributes, never clobbering an AI-set model).
        const hostAttrs: Record<string, unknown> = { gateway: isGateway };
        if (serviceHint) hostAttrs.service_hint = serviceHint;
        if (services && services.length) hostAttrs.services = services;
        await tx
          .insert(entitiesHost)
          .values({
            districtId: district.id,
            schoolId: school.id,
            mac,
            ip,
            hostname,
            vendor: cls.vendor,
            deviceType: cls.deviceType,
            classConfidence: cls.confidence,
            classMethod: cls.method,
            classSources: cls.sources,
            classSignalHash: cls.signalHash,
            attributes: hostAttrs,
            firstSeenAt: toDate(d.first_seen_at) ?? seen,
            lastSeenAt: seen,
          })
          .onConflictDoUpdate({
            target: [entitiesHost.districtId, entitiesHost.mac],
            set: {
              schoolId: school.id,
              ip,
              // Merge the fresh service signal into attributes (right side wins per
              // key, so a new hint updates but an AI-set `model` is preserved).
              attributes: sql`${entitiesHost.attributes} || ${JSON.stringify(hostAttrs)}::jsonb`,
              // Never downgrade a known hostname/type to null/unknown on a later
              // scan that happened to lack the data.
              hostname: sql`coalesce(excluded.hostname, ${entitiesHost.hostname})`,
              vendor: sql`coalesce(excluded.vendor, ${entitiesHost.vendor})`,
              deviceType: sql`case when excluded.device_type is null or excluded.device_type = 'unknown' then coalesce(${entitiesHost.deviceType}, excluded.device_type) else excluded.device_type end`,
              // Keep the scored fields in lockstep with whichever device_type wins
              // above: adopt the new scores only when we adopt the new type.
              classConfidence: sql`case when excluded.device_type is null or excluded.device_type = 'unknown' then ${entitiesHost.classConfidence} else excluded.class_confidence end`,
              classMethod: sql`case when excluded.device_type is null or excluded.device_type = 'unknown' then ${entitiesHost.classMethod} else excluded.class_method end`,
              classSources: sql`case when excluded.device_type is null or excluded.device_type = 'unknown' then ${entitiesHost.classSources} else excluded.class_sources end`,
              classSignalHash: sql`case when excluded.device_type is null or excluded.device_type = 'unknown' then ${entitiesHost.classSignalHash} else excluded.class_signal_hash end`,
              lastSeenAt: seen,
              updatedAt: new Date(),
            },
          });
        if (!macSeen.has(mac)) {
          macSeen.add(mac);
          counts.entities_host++;
        }
      }
    }

    // ---- canonical switches from the SNMP crawl (beyond directly-attached LLDP) ----
    // The crawl reaches switches the sensor isn't physically next to, so this is
    // where most of the fabric inventory comes from. Dedup on chassis_id; coalesce
    // so a later sparse crawl never nulls a name/description we already have.
    for (const scan of bundle.scans) {
      // Chassis serial # + clean model per polled device (ENTITY-MIB) for inventory.
      const switchIdentity = deriveSwitchIdentity(scan.snmp);
      for (const n of scan.snmpTopology?.nodes ?? []) {
        const chassis = str(n.chassis_id);
        if (!chassis) continue;
        if (isIpPhoneTopoNode(n)) continue; // don't list Cisco IP phones as switches
        const seen = toDate(scan.meta.completed_at) ?? new Date();
        const swIdent = switchIdentity.get((n.mgmt_ips && str(n.mgmt_ips[0])) ?? "");
        const swAttrs: Record<string, unknown> = {};
        if (swIdent?.serial) swAttrs.serial = swIdent.serial;
        if (swIdent?.model) swAttrs.model = swIdent.model;
        if (swIdent?.vendor) swAttrs.vendor = swIdent.vendor;
        await tx
          .insert(entitiesSwitch)
          .values({
            districtId: district.id,
            schoolId: school.id,
            chassisId: chassis,
            systemName: str(n.system_name),
            systemDescription: str(n.system_description),
            mgmtIp: (n.mgmt_ips && str(n.mgmt_ips[0])) ?? null,
            capabilities: n.capabilities ?? null,
            attributes: swAttrs,
            firstSeenAt: seen,
            lastSeenAt: seen,
          })
          .onConflictDoUpdate({
            target: [entitiesSwitch.districtId, entitiesSwitch.chassisId],
            set: {
              schoolId: school.id,
              systemName: sql`coalesce(excluded.system_name, ${entitiesSwitch.systemName})`,
              systemDescription: sql`coalesce(excluded.system_description, ${entitiesSwitch.systemDescription})`,
              mgmtIp: sql`coalesce(excluded.mgmt_ip, ${entitiesSwitch.mgmtIp})`,
              capabilities: sql`coalesce(excluded.capabilities, ${entitiesSwitch.capabilities})`,
              // Merge ENTITY-MIB serial/model into attributes (preserve other keys).
              attributes: sql`${entitiesSwitch.attributes} || ${JSON.stringify(swAttrs)}::jsonb`,
              lastSeenAt: seen,
              updatedAt: new Date(),
            },
          });
        if (!chassisSeen.has(chassis)) {
          chassisSeen.add(chassis);
          counts.entities_switch++;
        }
      }
    }

    // ---- topology snapshots: MERGE this sensor's view into the school's map ----
    // (was: overwrite from the primary scan, so a 2nd sensor clobbered the 1st)
    const primary =
      bundle.scans.find((s) => toBool(s.meta.is_primary)) ?? bundle.scans[0];
    const srcScanId = toNum(primary.meta.id);
    // Physical map = the local LLDP star (per-sensor) UNIONed with the SNMP
    // fabric crawl (chassis-keyed, multi-switch). Fabric nodes win on dedup
    // since they carry richer identity (system_description, mgmt_ip).
    const physicalGraph = mergeTopoGraphs(
      buildPhysicalGraph(primary.topology, srcScanId, sensor.id) as TopoGraph,
      buildSnmpFabricGraph(bundle.scans, srcScanId),
    );
    // Stamp this bundle's contribution with a freshness timestamp so the
    // accumulating per-school snapshot can age out gear no sensor still sees.
    const seenIso = (toDate(primary.meta.completed_at) ?? new Date()).toISOString();
    const stampSeen = (g: TopoGraph): TopoGraph => ({
      nodes: g.nodes.map((n) => ({ ...n, seenAt: seenIso })),
      edges: g.edges.map((e) => ({ ...e, seenAt: seenIso })),
      sourceScanId: g.sourceScanId,
    });
    const snapshots = [
      { kind: "physical", graph: stampSeen(physicalGraph) },
      { kind: "logical", graph: buildLogicalGraph(primary, srcScanId) },
    ];
    // Inputs for the physical connect-and-anchor pass: the WAN gateway and each
    // infra IP's traceroute distance (lower hop = more upstream), used to anchor
    // the Internet edge and root any disconnected islands toward it.
    const gatewayIp = str(primary.meta.gateway_ip);
    const hopsByIp = new Map<string, number>();
    for (const scan of bundle.scans) {
      for (const r of scan.reachability) {
        const ip = str(r.ip);
        const hops = toNum(r.traceroute_hops);
        if (ip && hops != null && hops < (hopsByIp.get(ip) ?? Infinity)) hopsByIp.set(ip, hops);
      }
    }
    const freshnessCutoff = new Date(Date.now() - 21 * 24 * 3600 * 1000).toISOString();
    for (const snap of snapshots) {
      const [existing] = await tx
        .select({ graph: topologySnapshots.graph })
        .from(topologySnapshots)
        .where(
          and(
            eq(topologySnapshots.kind, snap.kind),
            eq(topologySnapshots.scopeType, "school"),
            eq(topologySnapshots.scopeId, school.id),
          ),
        )
        .limit(1);
      const merged = mergeTopoGraphs(
        (existing?.graph as TopoGraph | undefined) ?? null,
        snap.graph as TopoGraph,
      );
      // MAP-5: collapse placeholder cdp:/ip: nodes into their chassis node (physical
      // only) and migrate any saved map positions to follow the rekeying.
      let finalGraph = merged;
      if (snap.kind === "physical") {
        // Reconcile placeholders + gateway into ONE graph, anchor the Internet
        // edge, bridge disconnected islands with inferred links, and prune stale
        // nodes — so the map reads as a connected hierarchy, not floating stars.
        const rec = connectPhysicalGraph(merged as unknown as Graph, {
          gatewayIp,
          hopsByIp,
          freshnessCutoff,
        });
        finalGraph = rec.graph as unknown as TopoGraph;
        if (rec.remap.size > 0) {
          const placed = await tx
            .select({ nodeId: topologyPositions.nodeId })
            .from(topologyPositions)
            .where(
              and(
                eq(topologyPositions.schoolId, school.id),
                eq(topologyPositions.kind, "physical"),
              ),
            );
          const placedIds = new Set(placed.map((p) => p.nodeId));
          for (const [oldId, newId] of rec.remap) {
            if (!placedIds.has(oldId)) continue;
            const where = and(
              eq(topologyPositions.schoolId, school.id),
              eq(topologyPositions.kind, "physical"),
              eq(topologyPositions.nodeId, oldId),
            );
            if (placedIds.has(newId)) {
              // Canonical node already has a position → just drop the orphan.
              await tx.delete(topologyPositions).where(where);
            } else {
              // Move the placeholder's saved spot onto the canonical id.
              await tx.update(topologyPositions).set({ nodeId: newId }).where(where);
              placedIds.add(newId);
            }
          }
        }
      }
      await tx
        .insert(topologySnapshots)
        .values({
          kind: snap.kind,
          scopeType: "school",
          scopeId: school.id,
          graph: finalGraph,
          generatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            topologySnapshots.kind,
            topologySnapshots.scopeType,
            topologySnapshots.scopeId,
          ],
          set: { graph: finalGraph, generatedAt: new Date() },
        });
    }

    // ---- PERF-3: uplink utilization samples (counter deltas vs committed rate) ----
    await persistUplinkSamples(tx, school.id, sensor.id, bundle.scans);

    // ---- daily health rollup (per district+school+day) ----
    if (day) {
      const metrics = {
        deviceCount: counts.devices,
        hostEntityCount: macSeen.size,
        switchCount: chassisSeen.size,
        findingCount: healthFindings,
        dhcpCount: healthDhcp,
        stpEventCount: healthStp,
        dnsProbeCount: healthDns,
        scanCount: counts.scan_runs,
      };
      await tx
        .insert(healthRollupDaily)
        .values({ districtId: district.id, schoolId: school.id, day, metrics })
        .onConflictDoUpdate({
          target: [
            healthRollupDaily.districtId,
            healthRollupDaily.schoolId,
            healthRollupDaily.day,
          ],
          set: { metrics },
        });
    }

    return { skipped: false } as const;
  });

  return {
    bundle: bundle.filename,
    district: ident.district,
    school: ident.school,
    device: ident.device,
    scans: bundle.scans.length,
    counts,
    skipped: result.skipped,
  };
}
