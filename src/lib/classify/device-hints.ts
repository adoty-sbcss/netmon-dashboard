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
