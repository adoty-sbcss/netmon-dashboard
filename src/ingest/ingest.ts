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
import { and, eq } from "drizzle-orm";
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
  stpEvents,
  trafficStats,
  snmpPolls,
  hostSwitchPorts,
  findings as findingsTbl,
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
/** Cap applied only to non-priority bulk rows (ifTable, ipNetToMediaTable, …). */
const SNMP_BULK_ROW_CAP = 500;

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

function buildPhysicalGraph(topo: RawTopology | null, sourceScanId: number | null) {
  if (!topo) return { nodes: [], edges: [], sourceScanId };
  const keepNode = (t?: string) =>
    t === "scanner" || t === "switch" || t === "gateway";
  const keepEdge = (k?: string) => k === "lldp" || k === "cdp" || k === "default_route";
  const nodes = (topo.nodes ?? []).filter((n) => keepNode(n.type));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = (topo.edges ?? []).filter(
    (e) => keepEdge(e.kind) && ids.has(e.source) && ids.has(e.target),
  );
  return { nodes, edges, sourceScanId };
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
    snmp_polls: 0,
    host_switch_ports: 0,
    findings: 0,
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
    const macSeen = new Set<string>();
    const chassisSeen = new Set<string>();
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
      }));
      if (dhcpRows.length) {
        await tx.insert(dhcpObservations).values(dhcpRows);
        counts.dhcp_observations += dhcpRows.length;
        healthDhcp += dhcpRows.length;
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
      const snmpSlice = [...keptSnmp, ...bulkSnmp.slice(0, SNMP_BULK_ROW_CAP)];
      const snmpRows = snmpSlice.map((p) => ({
        scanRunId,
        deviceIp: str(p.device_ip),
        oid: str(p.oid),
        oidName: str(p.oid_name),
        value: str(p.value),
        polledAt: toDate(p.polled_at),
      }));
      if (snmpRows.length) {
        await tx.insert(snmpPolls).values(snmpRows);
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
        await tx.insert(hostSwitchPorts).values(portRows);
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
        await tx
          .insert(entitiesHost)
          .values({
            districtId: district.id,
            schoolId: school.id,
            mac,
            ip: str(d.ip),
            hostname: str(d.hostname),
            vendor: str(d.vendor),
            firstSeenAt: toDate(d.first_seen_at) ?? seen,
            lastSeenAt: seen,
          })
          .onConflictDoUpdate({
            target: [entitiesHost.districtId, entitiesHost.mac],
            set: {
              schoolId: school.id,
              ip: str(d.ip),
              hostname: str(d.hostname),
              vendor: str(d.vendor),
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

    // ---- topology snapshots (from the primary/first scan) per school ----
    const primary =
      bundle.scans.find((s) => toBool(s.meta.is_primary)) ?? bundle.scans[0];
    const srcScanId = toNum(primary.meta.id);
    const snapshots = [
      { kind: "physical", graph: buildPhysicalGraph(primary.topology, srcScanId) },
      { kind: "logical", graph: buildLogicalGraph(primary, srcScanId) },
    ];
    for (const snap of snapshots) {
      await tx
        .insert(topologySnapshots)
        .values({
          kind: snap.kind,
          scopeType: "school",
          scopeId: school.id,
          graph: snap.graph,
          generatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            topologySnapshots.kind,
            topologySnapshots.scopeType,
            topologySnapshots.scopeId,
          ],
          set: { graph: snap.graph, generatedAt: new Date() },
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
