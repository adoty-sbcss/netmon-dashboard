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

/**
 * Printer / print-server signatures seen in SNMP sysDescr OR hrDeviceDescr. Covers
 * HP JetDirect ("HP ETHERNET MULTI-ENVIRONMENT"), the common laser/inkjet families,
 * and big-vendor MFPs. Used to keep printers — which answer SNMP but are NOT
 * forwarding devices — out of the switch fabric (inventory + map). Conservative:
 * every token is printer-specific so a real switch's sysDescr can't match.
 */
const PRINTER_RE =
  /jetdirect|hp ethernet multi-?environment|laserjet|officejet|designjet|deskjet|\bprinter\b|imagerunner|\bMFP\b|\bfiery\b|lexmark|kyocera|\bricoh\b|\bxerox\b|magicard|troy group/i;

/** True when an SNMP system description or hrDeviceDescr clearly names a printer. */
export function looksLikePrinter(
  sysDescr: string | null | undefined,
  hrDeviceDescr?: string | null | undefined,
): boolean {
  return (
    (!!sysDescr && PRINTER_RE.test(sysDescr)) ||
    (!!hrDeviceDescr && PRINTER_RE.test(hrDeviceDescr))
  );
}

/**
 * A raw SNMP topology node that is really a PRINTER (answered SNMP, so the fabric
 * crawl recorded it as a switch). Detected from its sysDescr and, when available,
 * the hrDeviceDescr polled for its management IP. Mirrors isIpPhoneTopoNode so the
 * ingest switch loop can skip it the same way.
 */
export function isPrinterTopoNode(
  n: { system_description?: unknown },
  hrDeviceDescr?: string | null,
): boolean {
  return looksLikePrinter(asStr(n.system_description), hrDeviceDescr);
}

/**
 * A stored map node (carrying `description`/`label`) that is a printer crawled as a
 * switch — pruned from the union-merged snapshot at read time like isIpPhoneMapNode,
 * so existing data clears without a re-ingest.
 */
export function isPrinterMapNode(n: { description?: unknown; label?: unknown }): boolean {
  return looksLikePrinter(asStr(n.description), asStr(n.label));
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
  // A printer that answered SNMP gets swept into the crawl as a "switch" — relabel
  // it so it leaves the fabric inventory + drops off the infrastructure map. Checked
  // first: printer signatures are unambiguous and shouldn't be overridden by an
  // incidental keyword match below.
  if (looksLikePrinter(sysDescr)) return "printer";
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
