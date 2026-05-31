/**
 * MAC-prefix (OUI) → vendor lookup + best-effort device-type classification.
 *
 * Vendor names come from the FULL IEEE MA-L registry (src/lib/oui/oui-registry.json,
 * ~39k prefixes, regenerated from standards-oui.ieee.org/oui/oui.csv). Device type
 * is inferred from SNMP sysDescr > hostname keywords > vendor-name keywords >
 * randomized-MAC detection.
 *
 * SERVER/CLI ONLY: importing this pulls the ~1MB registry. UI components should
 * import the lightweight vocabulary from ./types instead. Re-exported here for
 * server-side convenience.
 */
import REGISTRY from "./oui-registry.json";
import { DEVICE_TYPE_LABELS, type DeviceType } from "./types";

export { DEVICE_TYPE_LABELS, type DeviceType };

const OUI: Record<string, string> = REGISTRY as Record<string, string>;
const HEX6 = /^[0-9A-F]{6}$/;

/** Strip separators, uppercase, return the first 6 hex chars (the OUI), or null. */
export function macPrefix(mac: string | null | undefined): string | null {
  if (!mac) return null;
  const clean = mac.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  if (clean.length < 6) return null;
  const p = clean.slice(0, 6);
  return HEX6.test(p) ? p : null;
}

/** True if the MAC is locally administered (2nd-least-significant bit of byte 0). */
export function isLocallyAdministered(mac: string | null | undefined): boolean {
  const p = macPrefix(mac);
  if (!p) return false;
  const firstByte = parseInt(p.slice(0, 2), 16);
  return (firstByte & 0x02) === 0x02;
}

/** OUI → manufacturer (IEEE registry), or null if unknown. */
export function lookupVendor(mac: string | null | undefined): string | null {
  const p = macPrefix(mac);
  if (!p) return null;
  return OUI[p] ?? null;
}

/** Treat empty / "unknown" / "n/a" vendor strings as "no vendor". */
export function isBlankVendor(v: string | null | undefined): boolean {
  if (!v) return true;
  const s = v.trim().toLowerCase();
  return (
    s === "" || s === "unknown" || s === "n/a" || s === "-" || s === "none" || s === "?"
  );
}

// ---- classification rules (most-specific signal wins) ----------------------

const HOSTNAME_RULES: { type: DeviceType; re: RegExp }[] = [
  { type: "printer", re: /print|laserjet|officejet|\bmfp\b|\bmfc\b|copier|kyocera|lexmark|ricoh|xerox|brother|canon|epson/i },
  { type: "phone", re: /\bvoip\b|\bsip\b|\bphone\b|polycom|yealink|grandstream|\bspa\d/i },
  { type: "camera", re: /\bcam\b|camera|axis|hikvision|dahua|avigilon|\bnvr\b|\bdvr\b/i },
  { type: "ap", re: /\bap[-_ ]?\d|access[-_ ]?point|\bwap\b|aironet|meraki|aruba|unifi|\bwifi\b/i },
  { type: "switch", re: /\bsw[-_ ]?\d|switch|catalyst|\bcsw\b|\bdsw\b|\basw\b/i },
  { type: "router", re: /\brtr\b|router|gateway|\bgw[-_ ]?\d/i },
  { type: "firewall", re: /firewall|\bfw[-_ ]?\d|fortigate|palo|sonicwall|\basa\b/i },
  { type: "server", re: /\bsrv\b|server|\besxi\b|\bvcenter\b|\bdc0?\d\b|\bsql\b|\bdns\b|\bdhcp\b/i },
  { type: "storage", re: /\bnas\b|synology|qnap|\bsan\b|isilon|netapp/i },
  { type: "computer", re: /\bpc[-_ ]?\d|desktop|laptop|workstation|\bwks\b|chromebook|macbook|imac/i },
  { type: "mobile", re: /iphone|ipad|android|galaxy|pixel|mobile|tablet/i },
];

const SNMP_RULES: { type: DeviceType; re: RegExp }[] = [
  { type: "switch", re: /catalyst|switch|\bIOS\b|procurve|aruba.*switch|\bEXOS\b|nx-?os/i },
  { type: "router", re: /router|\bISR\b|\bASR\b|mikrotik|\bRouterOS\b/i },
  { type: "firewall", re: /fortigate|palo alto|\bASA\b|sonicwall|firewall/i },
  { type: "ap", re: /access point|\bAP\b|aironet|wireless/i },
  { type: "printer", re: /jetdirect|laserjet|officejet|printer|fiery|kyocera|lexmark/i },
  { type: "camera", re: /camera|\bIP cam|axis|hikvision/i },
  { type: "server", re: /windows server|linux|ubuntu|\besxi\b|vmware|red hat|centos/i },
];

// Vendor-name rules only for categories a manufacturer reliably implies. Network
// vendors (Cisco/HPE/Juniper) are intentionally omitted — vendor alone can't tell
// a switch from a router from a phone; those defer to hostname/SNMP.
const VENDOR_RULES: { type: DeviceType; re: RegExp }[] = [
  { type: "camera", re: /\baxis\b|hikvision|dahua|hanwha|vivotek|bosch security|mobotix|geovision|uniview|amcrest|reolink|wyze|lorex|swann/i },
  { type: "phone", re: /polycom|\bpoly\b|yealink|grandstream|\bmitel\b|aastra|\bsnom\b|sangoma|fanvil|audiocodes|cyberdata/i },
  { type: "printer", re: /lexmark|kyocera|\bricoh\b|\bxerox\b|brother|\bcanon\b|\bepson\b|zebra|konica|\bsharp\b|toshiba tec|primera|\bdymo\b|\bsato\b|oki data|pantum|\bsindoh\b/i },
  { type: "storage", re: /synology|\bqnap\b|netapp|\bdrobo\b|western digital|\bseagate\b|buffalo|terramaster/i },
  { type: "firewall", re: /fortinet|palo alto|sonicwall|watchguard|\bsophos\b|check point|barracuda|\bzyxel\b.*(firewall|security)/i },
  { type: "ap", re: /\baruba\b|ubiquiti|ruckus|aerohive|\bmist\b|cambium|edgecore|\bxirrus\b|open ?mesh/i },
  { type: "vm", re: /vmware|\bqemu\b|virtualbox|\bxen\b|parallels|nutanix/i },
];

// DHCP option-60 (vendor class id) → device type. This is a strong passive
// signal for endpoints that never speak SNMP — the classic device fingerprint.
const DHCP_VENDOR_RULES: { type: DeviceType; re: RegExp }[] = [
  { type: "printer", re: /jetdirect|hp.*(jet|print)|hewlett.*print|lexmark|\bcanon\b|epson|brother|kyocera|\bricoh\b|\bxerox\b|\bzebra\b|sharp.*mfp|toshiba.*tec/i },
  { type: "ap", re: /\baruba\b|arubaap|cisco ap|\bAIR-|meraki|\bmist\b|ruckus|ubiquiti|\bUAP\b|aerohive|cambium|engenius/i },
  { type: "phone", re: /polycom|yealink|grandstream|cisco ip phone|\bSEP[0-9A-F]|\bsnom\b|\bmitel\b|avaya.*phone|sip|fanvil|audiocodes/i },
  { type: "camera", re: /\baxis\b|hikvision|\bdahua\b|\bACTi\b|avigilon|hanwha|vivotek/i },
  { type: "firewall", re: /sonicwall|fortigate|palo ?alto|watchguard|\bsophos\b/i },
  { type: "storage", re: /synology|\bqnap\b|netapp|\bdrobo\b/i },
  { type: "vm", re: /\bvmware\b|\bqemu\b|virtualbox/i },
  { type: "mobile", re: /android-dhcp|\biphone\b|\bipad\b|\bipod\b|dhcpcd-.*android|samsung-android|\bMobile\b/i },
  { type: "computer", re: /MSFT|microsoft|windows|\bMacBook\b|chromeos|cros\b/i },
];

/** Classify from the DHCP fingerprint (option 60 vendor class / option 55). */
export function classifyByDhcp(
  vendorClass: string | null | undefined,
  _paramList?: string | null,
): DeviceType | null {
  if (vendorClass)
    for (const r of DHCP_VENDOR_RULES) if (r.re.test(vendorClass)) return r.type;
  return null;
}

/**
 * Best-effort device classification. Priority: SNMP sysDescr > DHCP vendor-class
 * fingerprint > hostname keywords > OUI vendor-name keywords > randomized-MAC
 * heuristic > unknown.
 */
export function classifyDeviceType(input: {
  mac?: string | null;
  vendor?: string | null;
  hostname?: string | null;
  snmpSysDescr?: string | null;
  dhcpVendorClass?: string | null;
  dhcpParamList?: string | null;
}): DeviceType {
  const { mac, hostname, snmpSysDescr } = input;
  const vendor = input.vendor ?? lookupVendor(mac);

  if (snmpSysDescr) for (const r of SNMP_RULES) if (r.re.test(snmpSysDescr)) return r.type;
  const byDhcp = classifyByDhcp(input.dhcpVendorClass, input.dhcpParamList);
  if (byDhcp) return byDhcp;
  if (hostname) for (const r of HOSTNAME_RULES) if (r.re.test(hostname)) return r.type;
  if (vendor && !isBlankVendor(vendor))
    for (const r of VENDOR_RULES) if (r.re.test(vendor)) return r.type;

  // Randomized/private MAC with no registry match: a deliberately-randomized
  // address (MAC privacy). Label it as such rather than guessing a device.
  if (isLocallyAdministered(mac) && !lookupVendor(mac)) return "randomized";

  return "unknown";
}

const RANDOMIZED_VENDOR = "Randomized (private) MAC";

/** One-shot enrichment for a host row: fill vendor from OUI, classify type. */
export function enrichHost(input: {
  mac?: string | null;
  vendor?: string | null;
  hostname?: string | null;
  snmpSysDescr?: string | null;
  dhcpVendorClass?: string | null;
  dhcpParamList?: string | null;
}): { vendor: string | null; deviceType: DeviceType } {
  let vendor = isBlankVendor(input.vendor) ? lookupVendor(input.mac) : (input.vendor ?? null);
  const deviceType = classifyDeviceType({ ...input, vendor });
  if (!vendor && deviceType === "randomized") vendor = RANDOMIZED_VENDOR;
  return { vendor: vendor ?? null, deviceType };
}
