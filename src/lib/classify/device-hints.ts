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
