/**
 * Bundle reader — the ONLY place that knows NetMon's hourly-bundle file layout.
 * Reads an *extracted* bundle directory into typed, loosely-validated structures.
 * (ZIP extraction belongs to the SFTP transport stage; this stage validates the
 * parse→DB mapping against already-extracted bundles.)
 *
 * Bundle layout (per the netmon collector):
 *   <bundle>/HOURLY_SUMMARY.md, README.md
 *   <bundle>/scans/scan_<id>/{summary.md,findings.json,topology.json,devices.csv,
 *                             metrics.json,timeline.json,dns_health.json}
 *   <bundle>/scans/scan_<id>/raw/{scan.json,arp-table.json,lldp-neighbors.json,
 *                                 stp-events.json,dhcp-observed.json,snmp-polls.json,
 *                                 traffic-stats.json,dns-probes.json}
 *
 * NOTE: bundle identity varies by collector version. Newer bundles carry
 * district_slug/school_slug/device_slug in scan.json; older ("App_Mon") bundles
 * carry only network_id + the collector name encoded in the folder/zip name
 * (e.g. "NetMonitor_01_2026_05_26_07"). resolveIdentity() handles both.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

// ---- raw JSON shapes (loose: versions vary, so everything is optional) ----

export interface RawScanMeta {
  id?: number;
  started_at?: string | null;
  completed_at?: string | null;
  trigger_reason?: string | null;
  interface?: string | null;
  interface_cidr?: string | null;
  gateway_ip?: string | null;
  gateway_mac?: string | null;
  network_id?: string | null;
  duration_sec?: number | null;
  mode?: string | null;
  notes?: string | null;
  error?: string | null;
  // newer-format identity (may be absent on older bundles):
  district_slug?: string | null;
  school_slug?: string | null;
  device_slug?: string | null;
  is_primary?: boolean | null;
  collector?: string | null;
}

export interface RawLldp {
  local_port?: string | null;
  protocol?: string | null;
  chassis_id?: string | null;
  port_id?: string | null;
  system_name?: string | null;
  system_description?: string | null;
  port_description?: string | null;
  vlan_id?: number | null;
  mgmt_ip?: string | null;
  capabilities?: string[] | null;
  seen_at?: string | null;
  extra?: unknown;
}

export interface RawDhcp {
  message_type?: string | null;
  server_ip?: string | null;
  server_mac?: string | null;
  client_mac?: string | null;
  offered_ip?: string | null;
  subnet_mask?: string | null;
  router?: string | null;
  dns_servers?: string | null;
  seen_at?: string | null;
  // DHCP device-fingerprint options (present on client DISCOVER/REQUEST/INFORM):
  // 60 = vendor class id, 55 = parameter request list, 12 = advertised hostname.
  vendor_class_id?: string | null;
  param_req_list?: string | null;
  client_hostname?: string | null;
}

export interface RawStp {
  bpdu_type?: string | null;
  root_bridge_id?: string | null;
  bridge_id?: string | null;
  port_id?: string | null;
  root_path_cost?: number | null;
  topology_change?: boolean | null;
  seen_at?: string | null;
}

export interface RawTraffic {
  interface?: string | null;
  bucket_start?: string | null;
  bucket_end?: string | null;
  rx_packets?: number | null;
  rx_bytes?: number | null;
  rx_errors?: number | null;
  rx_dropped?: number | null;
  tx_packets?: number | null;
  tx_bytes?: number | null;
  broadcast_packets?: number | null;
  multicast_packets?: number | null;
  tshark_total_packets?: number | null;
}

export interface RawSnmp {
  device_ip?: string | null;
  oid?: string | null;
  oid_name?: string | null;
  value?: string | null;
  polled_at?: string | null;
}

export interface RawDnsResolver {
  resolver_ip?: string | null;
  resolver_source?: string | null;
  probes?: number | null;
  ok?: number | null;
  errors?: number | null;
  nxdomain_rewrite?: boolean | null;
  mean_ms?: number | null;
}

export interface RawDnsProbe {
  resolver_ip?: string | null;
  resolver_source?: string | null;
  query_name?: string | null;
  query_type?: string | null;
  expected_status?: string | null;
  status?: string | null;
  query_time_ms?: number | null;
  answer_count?: number | null;
  answers_text?: string | null;
  error?: string | null;
  probed_at?: string | null;
}

/** dns_health.json (scan root, not raw/): per-resolver aggregate + raw probes. */
export interface RawDnsHealth {
  probe_count?: number | null;
  by_resolver?: RawDnsResolver[];
  probes?: RawDnsProbe[];
}

/** raw/net-reachability.json — one row per infrastructure candidate. */
export interface RawReachability {
  ip?: string | null;
  hostname?: string | null;
  vendor?: string | null;
  source?: string | null; // gateway | lldp | oui
  ping_alive?: boolean | null;
  ping_rtt_ms?: number | null;
  ping_loss_pct?: number | null;
  snmp_responded?: boolean | null;
  snmp_version?: string | null;
  traceroute_hops?: number | null;
  traceroute_path?: unknown;
  checked_at?: string | null;
}

export interface RawFinding {
  rule?: string | null;
  severity?: string | null;
  title?: string | null;
  detail?: string | null;
  message?: string | null;
  evidence?: unknown;
  created_at?: string | null;
  [k: string]: unknown;
}

export type DeviceRow = Record<string, string>;

export interface TopoNode {
  id: string;
  type?: string;
  label?: string;
  ip?: string | null;
  mac?: string | null;
  vendor?: string | null;
  mgmt_ip?: string | null;
  description?: string | null;
  capabilities?: string[] | null;
  source?: string | null;
}
export interface TopoEdge {
  source: string;
  target: string;
  kind?: string;
  local_port?: string | null;
  remote_port?: string | null;
  vlan?: number | null;
}
export interface RawTopology {
  scan_id?: number;
  nodes: TopoNode[];
  edges: TopoEdge[];
}

/** snmp_topology.json — the SNMP fabric crawl (chassis-keyed, multi-switch). */
export interface RawSnmpTopoNode {
  chassis_id?: string | null;
  system_name?: string | null;
  system_description?: string | null;
  mgmt_ips?: string[] | null;
  discovered_via_ip?: string | null;
  source?: string | null;
  capabilities?: string[] | null;
}
export interface RawSnmpTopoEdge {
  local_chassis_id?: string | null;
  local_port_id?: string | null;
  local_port_desc?: string | null;
  remote_chassis_id?: string | null;
  remote_port_id?: string | null;
  remote_port_desc?: string | null;
  via?: string | null;
  discovered_via_ip?: string | null;
}
export interface RawSnmpTopology {
  nodes?: RawSnmpTopoNode[];
  edges?: RawSnmpTopoEdge[];
}

export interface ScanData {
  meta: RawScanMeta;
  devices: DeviceRow[];
  lldp: RawLldp[];
  dhcp: RawDhcp[];
  stp: RawStp[];
  traffic: RawTraffic[];
  snmp: RawSnmp[];
  dns: RawDnsHealth;
  findings: RawFinding[];
  topology: RawTopology | null;
  snmpTopology: RawSnmpTopology | null;
  reachability: RawReachability[];
  scanDirName: string;
}

export interface Bundle {
  /** Idempotency key: the .zip filename (synthesized from the dir name if needed). */
  filename: string;
  dirName: string;
  scans: ScanData[];
}

// ---- coercion helpers (bundle values are display-only text/JSON) ----

export function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

export function toBool(v: unknown): boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase();
  if (["true", "1", "yes", "t"].includes(s)) return true;
  if (["false", "0", "no", "f"].includes(s)) return false;
  return null;
}

/** Parse ISO (or "YYYY-MM-DD HH:MM:SS+00:00") into a Date, or null. */
export function toDate(v: unknown): Date | null {
  if (!v || typeof v !== "string") return null;
  const norm = v.includes("T") ? v : v.replace(" ", "T");
  const d = new Date(norm);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Lowercase, collapse to a URL/path-safe slug. */
export function slugify(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---- minimal RFC-4180 CSV parser (vendor fields contain quoted commas) ----

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function parseCsv(text: string | null): DeviceRow[] {
  if (!text) return [];
  const rows = csvRows(text);
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows
    .slice(1)
    .filter((r) => !(r.length === 1 && r[0] === ""))
    .map((r) => {
      const o: DeviceRow = {};
      header.forEach((h, i) => {
        o[h] = r[i] ?? "";
      });
      return o;
    });
}

// ---- readers ----

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function readMaybe(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function asList<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** Read one extracted bundle directory into a typed Bundle. */
export function readBundleDir(dir: string): Bundle {
  const dirName = basename(dir.replace(/[\\/]+$/, ""));
  const scansRoot = join(dir, "scans");
  const scans: ScanData[] = [];

  if (existsSync(scansRoot)) {
    for (const entry of readdirSync(scansRoot).sort()) {
      const scanDir = join(scansRoot, entry);
      if (!entry.startsWith("scan_") || !statSync(scanDir).isDirectory()) continue;
      const raw = join(scanDir, "raw");
      scans.push({
        meta: readJson<RawScanMeta>(join(raw, "scan.json"), {}),
        devices: parseCsv(readMaybe(join(scanDir, "devices.csv"))),
        lldp: asList<RawLldp>(readJson(join(raw, "lldp-neighbors.json"), [])),
        dhcp: asList<RawDhcp>(readJson(join(raw, "dhcp-observed.json"), [])),
        stp: asList<RawStp>(readJson(join(raw, "stp-events.json"), [])),
        traffic: asList<RawTraffic>(readJson(join(raw, "traffic-stats.json"), [])),
        snmp: asList<RawSnmp>(readJson(join(raw, "snmp-polls.json"), [])),
        dns: readJson<RawDnsHealth>(join(scanDir, "dns_health.json"), {}),
        findings: asList<RawFinding>(readJson(join(scanDir, "findings.json"), [])),
        topology: readJson<RawTopology | null>(join(scanDir, "topology.json"), null),
        // SNMP fabric crawl (multi-switch). Ships as {nodes,edges}; empty when
        // the crawl is off or found nothing. Falls back to the raw/ split files.
        snmpTopology:
          readJson<RawSnmpTopology | null>(join(scanDir, "snmp_topology.json"), null) ??
          {
            nodes: asList<RawSnmpTopoNode>(
              readJson(join(raw, "snmp-topology-nodes.json"), []),
            ),
            edges: asList<RawSnmpTopoEdge>(
              readJson(join(raw, "snmp-topology-edges.json"), []),
            ),
          },
        reachability: asList<RawReachability>(
          readJson(join(raw, "net-reachability.json"), []),
        ),
        scanDirName: entry,
      });
    }
  }

  const filename = dirName.toLowerCase().endsWith(".zip")
    ? dirName
    : `${dirName}.zip`;
  return { filename, dirName, scans };
}

/** "NetMonitor_01_2026_05_26_07" -> "netmonitor_01" (collector name as device slug). */
export function collectorFromDirName(name: string): string | null {
  const parts = name.split("_");
  return parts.length >= 2 ? slugify(`${parts[0]}_${parts[1]}`) : null;
}
