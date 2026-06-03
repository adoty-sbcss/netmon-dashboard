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
import { and, eq, sql } from "drizzle-orm";
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
  healthRollupDaily,
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
} from "./bundle";
import { enrichHost } from "../lib/oui";

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
    .filter((n) => keepNode(n.type))
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
      const id = `switch:${chassis}`;
      nodeById.set(id, {
        id,
        type: "switch",
        label: str(n.system_name) ?? chassis,
        description: str(n.system_description),
        mgmt_ip: (n.mgmt_ips && str(n.mgmt_ips[0])) ?? null,
        source: str(n.source) ?? "snmp",
        capabilities: n.capabilities ?? null,
      });
    }
    for (const e of topo.edges ?? []) {
      const a = str(e.local_chassis_id);
      const b = str(e.remote_chassis_id);
      if (!a || !b) continue;
      const source = `switch:${a}`;
      const target = `switch:${b}`;
      const kind = str(e.via) ?? "lldp";
      edgeByKey.set(`${source}|${target}|${kind}`, {
        source,
        target,
        kind,
        local_port: str(e.local_port_id) ?? str(e.local_port_desc),
        remote_port: str(e.remote_port_id) ?? str(e.remote_port_desc),
      });
    }
  }
  return { nodes: [...nodeById.values()], edges: [...edgeByKey.values()], sourceScanId };
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

    const [existing] = await tx
      .select()
      .from(ingestedBundles)
      .where(eq(ingestedBundles.filename, bundle.filename));

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

      // ---- canonical hosts (dedup on mac within district) ----
      for (const d of scan.devices) {
        const mac = str(d.mac);
        if (!mac) continue; // need a MAC to dedup
        const seen = toDate(d.last_seen_at) ?? completedAt;
        const fp = dhcpFp.get(mac.toLowerCase());
        // Prefer the discovered hostname; fall back to the name the client
        // advertised over DHCP (option 12) when PTR/nmap gave us nothing.
        const hostname = str(d.hostname) ?? fp?.hostname ?? null;
        // Enrich: fill manufacturer from the OUI registry when the bundle says
        // "unknown"/blank, and classify device type from SNMP + DHCP fingerprint
        // + hostname + vendor. Pure/offline.
        const { vendor, deviceType } = enrichHost({
          mac,
          vendor: str(d.vendor),
          hostname,
          dhcpVendorClass: fp?.vendorClass ?? null,
          dhcpParamList: fp?.paramList ?? null,
        });
        await tx
          .insert(entitiesHost)
          .values({
            districtId: district.id,
            schoolId: school.id,
            mac,
            ip: str(d.ip),
            hostname,
            vendor,
            deviceType,
            firstSeenAt: toDate(d.first_seen_at) ?? seen,
            lastSeenAt: seen,
          })
          .onConflictDoUpdate({
            target: [entitiesHost.districtId, entitiesHost.mac],
            set: {
              schoolId: school.id,
              ip: str(d.ip),
              // Never downgrade a known hostname/type to null/unknown on a later
              // scan that happened to lack the data.
              hostname: sql`coalesce(excluded.hostname, ${entitiesHost.hostname})`,
              vendor: sql`coalesce(excluded.vendor, ${entitiesHost.vendor})`,
              deviceType: sql`case when excluded.device_type is null or excluded.device_type = 'unknown' then coalesce(${entitiesHost.deviceType}, excluded.device_type) else excluded.device_type end`,
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
      for (const n of scan.snmpTopology?.nodes ?? []) {
        const chassis = str(n.chassis_id);
        if (!chassis) continue;
        const seen = toDate(scan.meta.completed_at) ?? new Date();
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
    const snapshots = [
      { kind: "physical", graph: physicalGraph },
      { kind: "logical", graph: buildLogicalGraph(primary, srcScanId) },
    ];
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
      await tx
        .insert(topologySnapshots)
        .values({
          kind: snap.kind,
          scopeType: "school",
          scopeId: school.id,
          graph: merged,
          generatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            topologySnapshots.kind,
            topologySnapshots.scopeType,
            topologySnapshots.scopeId,
          ],
          set: { graph: merged, generatedAt: new Date() },
        });
    }

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
