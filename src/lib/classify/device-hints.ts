/**
 * Device-identity heuristics shared by ingest and the read queries. No heavy
 * deps — safe to import anywhere server-side.
 */

/**
 * Cisco IP phones advertise their CDP device-id as "SEP<12-hex MAC>" (SEP =
 * Selsius Ethernet Phone). The SNMP/CDP fabric crawl otherwise records them as
 * switches — cluttering the switch inventory and exploding the topology map — so
 * we detect them and exclude them from both. The 12 hex chars are the phone's MAC.
 */
const SEP_PHONE = /^SEP[0-9A-Fa-f]{12}$/;

export function isCiscoIpPhoneName(name: string | null | undefined): boolean {
  return !!name && SEP_PHONE.test(name.trim());
}

const asStr = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * A raw topology/CDP node that is really an IP phone (Cisco SEP device-id, or CDP
 * capabilities advertising "phone"), not infrastructure.
 */
export function isIpPhoneTopoNode(n: {
  chassis_id?: unknown;
  system_name?: unknown;
  capabilities?: unknown;
}): boolean {
  if (isCiscoIpPhoneName(asStr(n.chassis_id)) || isCiscoIpPhoneName(asStr(n.system_name))) return true;
  const caps = Array.isArray(n.capabilities) ? n.capabilities.map((c) => String(c).toLowerCase()) : [];
  return caps.includes("phone");
}

/**
 * A stored map node (id like "switch:<chassis>", plus a label) that is a Cisco IP
 * phone crawled as a switch — used to prune the union-merged snapshot at read time.
 */
export function isIpPhoneMapNode(n: { id?: unknown; label?: unknown }): boolean {
  const id = asStr(n.id) ?? "";
  const chassis = id.startsWith("switch:") ? id.slice("switch:".length) : id;
  return isCiscoIpPhoneName(chassis) || isCiscoIpPhoneName(asStr(n.label));
}

// Non-forwarding SNMP endpoint signatures (sysDescr OR hrDeviceDescr). These devices
// answer SNMP and get swept into the fabric crawl as "switches"; each token is
// endpoint-specific so a real switch can't match, and ingest ALSO guards with
// bridge/FDB evidence before dropping anything (see ingest's switch loops).
const PRINTER_RE =
  /jetdirect|hp ethernet multi-?environment|laserjet|officejet|designjet|deskjet|\bprinter\b|imagerunner|\bMFP\b|\bfiery\b|lexmark|kyocera|\bricoh\b|\bxerox\b|magicard|troy group/i;
const UPS_RE =
  /smart-ups|symmetra|\bpowernet\b|ups network management|network management card.*ups|\bAPC\b.*\bups\b|eaton.*\bups\b|tripp.?lite|\bliebert\b|powerware|switched rack pdu|\bRPDU\b/i;
const CAMERA_RE =
  /\bIP ?camera\b|network camera|\bNVR\b|hikvision|\bdahua\b|axis.*(camera|network camera|video)|geovision|\bONVIF\b|avigilon|vivotek/i;

/**
 * Classify a non-forwarding SNMP ENDPOINT (printer / UPS / camera) from its sysDescr
 * + hrDeviceDescr. Returns the device type or null. Used to keep these out of the
 * switch fabric (they answer SNMP but don't bridge/route).
 */
export function endpointTypeFromSnmp(
  sysDescr: string | null | undefined,
  hrDeviceDescr?: string | null | undefined,
): "printer" | "ups" | "camera" | null {
  const s = `${sysDescr ?? ""}\n${hrDeviceDescr ?? ""}`;
  if (!s.trim()) return null;
  if (PRINTER_RE.test(s)) return "printer";
  if (UPS_RE.test(s)) return "ups";
  if (CAMERA_RE.test(s)) return "camera";
  return null;
}

/** True when sysDescr/hrDeviceDescr clearly names a non-forwarding endpoint. */
export function looksLikeEndpoint(
  sysDescr: string | null | undefined,
  hrDeviceDescr?: string | null | undefined,
): boolean {
  return endpointTypeFromSnmp(sysDescr, hrDeviceDescr) != null;
}

/** Printer-specific check (kept for the common case + back-compat). */
export function looksLikePrinter(
  sysDescr: string | null | undefined,
  hrDeviceDescr?: string | null | undefined,
): boolean {
  return endpointTypeFromSnmp(sysDescr, hrDeviceDescr) === "printer";
}

/**
 * A raw SNMP topology node that is really a non-forwarding endpoint (printer / UPS /
 * camera that answered SNMP, so the crawl recorded it as a switch). Detected from
 * sysDescr + the hrDeviceDescr polled for its mgmt IP. Mirrors isIpPhoneTopoNode.
 */
export function isEndpointTopoNode(
  n: { system_description?: unknown },
  hrDeviceDescr?: string | null,
): boolean {
  return looksLikeEndpoint(asStr(n.system_description), hrDeviceDescr);
}

/**
 * A stored map node (carrying `description`/`label`) that is a non-forwarding
 * endpoint crawled as a switch — pruned at read time like isIpPhoneMapNode so
 * existing data clears without a re-ingest.
 */
export function isEndpointMapNode(n: { description?: unknown; label?: unknown }): boolean {
  return looksLikeEndpoint(asStr(n.description), asStr(n.label));
}

/**
 * Refine a crawled "switch" node into its real infra role from LLDP/CDP
 * capabilities + the SNMP system description. APs, routers, firewalls and phones
 * all get swept into the discovered-switch table by the fabric crawl, so this
 * promotes them to the right type for the inventory AND the map.
 *
 * AP detection is keyed on AP-SPECIFIC tokens (Instant/IAP, `AP-<model>`,
 * `ArubaOS (…)`, Meraki MR, UAP, etc.) so Aruba/HPE SWITCHES (ArubaOS-CX,
 * ProCurve, JL…) are NOT mislabeled as APs.
 */
export function refineInfraType(
  base: string,
  caps: string[] | null,
  sysDescr: string | null,
): string {
  const c = (caps ?? []).map((s) => s.toLowerCase());
  // A non-forwarding endpoint (printer/UPS/camera) that answered SNMP gets swept into
  // the crawl as a "switch" — relabel to its real type so it leaves the fabric
  // inventory + drops off the infra map. Checked first: the signatures are
  // unambiguous and shouldn't be overridden by an incidental keyword match below.
  const ep = endpointTypeFromSnmp(sysDescr);
  if (ep) return ep;
  if (c.some((x) => x.includes("access-point") || x.includes("wlan") || x === "ap")) return "ap";
  if (
    sysDescr &&
    /access point|aironet|wireless lan|\bWAP\b|instant ?ap|\bIAP\b|\bAP-\d{2,}|aruba\w*\s+ap\b|arubaos\s*\(|meraki\s*mr|\bMR\d{2,}\b|\bUAP\b|aerohive|engenius|cambium/i.test(
      sysDescr,
    )
  )
    return "ap";
  if (sysDescr && /firewall|fortigate|palo alto|\bASA\b|sonicwall/i.test(sysDescr)) return "firewall";
  if (c.includes("telephone")) return "phone";
  if (c.includes("router") && !c.includes("bridge")) return "router";
  if (sysDescr && /\brouter\b|\bISR\b|\bASR\b|RouterOS/i.test(sysDescr)) return "router";
  if (base === "gateway") return "router";
  if (base === "scanner") return "scanner";
  return "switch";
}
