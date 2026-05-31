/**
 * MAC-prefix (OUI) → vendor lookup + best-effort device-type classification.
 *
 * NetMon bundles often arrive with vendor="unknown" (the collector doesn't ship
 * the full IEEE registry) and no device type at all. We enrich here at ingest:
 *   - lookupVendor(mac):    OUI-prefix → manufacturer
 *   - classifyDeviceType(): manufacturer + hostname + SNMP sysDescr → a coarse
 *                           type a network admin can scan at a glance.
 *
 * The OUI table is a CURATED subset weighted toward what shows up on a K-12
 * campus (Cisco/Meraki/Aruba switches+APs, HP/Brother/Canon/etc. printers,
 * Polycom/Yealink phones, Axis/Hikvision cameras, Apple/Dell/Lenovo endpoints).
 * It is intentionally not the full 35k-entry registry — it stays small, has no
 * runtime dependency, and is trivial to extend. Unknown prefixes fall through
 * to null, exactly as before, so nothing regresses.
 *
 * Pure data + functions: no DB, no Node-only APIs — safe to import from the
 * ingest CLI (tsx), server components, and the browser bundle alike.
 */

export type DeviceType =
  | "switch"
  | "router"
  | "ap"
  | "firewall"
  | "printer"
  | "phone"
  | "camera"
  | "computer"
  | "server"
  | "mobile"
  | "storage"
  | "iot"
  | "vm"
  | "unknown";

/** Human labels for the UI. */
export const DEVICE_TYPE_LABELS: Record<DeviceType, string> = {
  switch: "Switch",
  router: "Router",
  ap: "Access point",
  firewall: "Firewall",
  printer: "Printer",
  phone: "IP phone",
  camera: "Camera",
  computer: "Computer",
  server: "Server",
  mobile: "Mobile",
  storage: "Storage / NAS",
  iot: "IoT",
  vm: "Virtual machine",
  unknown: "Unknown",
};

interface OuiEntry {
  vendor: string;
  /** A strong vendor-level type hint (used only when nothing better is known). */
  type?: DeviceType;
}

/**
 * OUI (first 24 bits of the MAC, uppercase hex, no separators) → vendor.
 * Curated; extend freely. `type` is a *hint* only — hostname/SNMP win over it.
 */
export const OUI_TABLE: Record<string, OuiEntry> = {
  // ---- Cisco (incl. Meraki, Linksys-era, SPA phones) ----
  "00000C": { vendor: "Cisco" },
  "000142": { vendor: "Cisco" },
  "000163": { vendor: "Cisco" },
  "0001C7": { vendor: "Cisco" },
  "000A41": { vendor: "Cisco" },
  "000D65": { vendor: "Cisco" },
  "001121": { vendor: "Cisco" },
  "0018B9": { vendor: "Cisco" },
  "001A2F": { vendor: "Cisco" },
  "001B0C": { vendor: "Cisco" },
  "001E13": { vendor: "Cisco" },
  "002414": { vendor: "Cisco" },
  "00DEFB": { vendor: "Cisco" },
  "188B9D": { vendor: "Cisco" },
  "2C3F38": { vendor: "Cisco" },
  "508789": { vendor: "Cisco" },
  "6C5E3B": { vendor: "Cisco" },
  "844B14": { vendor: "Cisco" },
  "E8B7D6": { vendor: "Cisco Meraki", type: "ap" },
  "0018D3": { vendor: "Cisco Meraki", type: "ap" },
  "88153F": { vendor: "Cisco Meraki", type: "ap" },
  "9C5C8E": { vendor: "Cisco Meraki", type: "ap" },
  "AC17C8": { vendor: "Cisco Meraki", type: "ap" },
  "E0CB4E": { vendor: "Cisco SPA (phone)", type: "phone" },
  "00045A": { vendor: "Linksys" },
  "001310": { vendor: "Linksys" },

  // ---- HPE / Aruba (switches + APs) ----
  "000B86": { vendor: "Aruba Networks", type: "ap" },
  "001A1E": { vendor: "Aruba Networks", type: "ap" },
  "24DEC6": { vendor: "Aruba Networks", type: "ap" },
  "6CF37F": { vendor: "Aruba Networks", type: "ap" },
  "843497": { vendor: "Aruba Networks", type: "ap" },
  "9C1C12": { vendor: "Aruba Networks", type: "ap" },
  "204C03": { vendor: "Aruba Networks", type: "ap" },
  "000883": { vendor: "HP / HPE" },
  "001083": { vendor: "HP / HPE" },
  "0017A4": { vendor: "HP / HPE" },
  "002264": { vendor: "HP / HPE" },
  "3863BB": { vendor: "HP Inc." },
  "3CD92B": { vendor: "HP Inc." },
  "9457A5": { vendor: "HP Inc." },
  "A0481C": { vendor: "HP Inc." },
  "D48564": { vendor: "HP Inc." },
  "70106F": { vendor: "HP Inc." },
  "001321": { vendor: "HP (printer)", type: "printer" },
  "001E0B": { vendor: "HP (printer)", type: "printer" },

  // ---- Other network gear ----
  "245A4C": { vendor: "Ubiquiti", type: "ap" },
  "44D9E7": { vendor: "Ubiquiti", type: "ap" },
  "788A20": { vendor: "Ubiquiti", type: "ap" },
  "802AA8": { vendor: "Ubiquiti", type: "ap" },
  "B4FBE4": { vendor: "Ubiquiti", type: "ap" },
  "FCECDA": { vendor: "Ubiquiti", type: "ap" },
  "0418D6": { vendor: "Ubiquiti", type: "ap" },
  "001392": { vendor: "Ruckus Wireless", type: "ap" },
  "0C5415": { vendor: "Ruckus Wireless", type: "ap" },
  "2C5D93": { vendor: "Ruckus Wireless", type: "ap" },
  "00040D": { vendor: "Avaya" },
  "000FE2": { vendor: "Juniper / Netscreen" },
  "2C6BF5": { vendor: "Juniper Networks" },
  "3C6104": { vendor: "Juniper Networks" },
  "0009E8": { vendor: "Extreme Networks" },
  "00040F": { vendor: "Extreme Networks" },
  "000496": { vendor: "Extreme Networks" },
  "0090FB": { vendor: "Fortinet", type: "firewall" },
  "085B0E": { vendor: "Fortinet", type: "firewall" },
  "70DB98": { vendor: "Fortinet", type: "firewall" },
  "001B17": { vendor: "Palo Alto Networks", type: "firewall" },
  "000E83": { vendor: "Netgear" },
  "20E52A": { vendor: "Netgear" },
  "A040A0": { vendor: "Netgear" },
  "1C7EE5": { vendor: "D-Link" },
  "14D64D": { vendor: "D-Link" },
  "50C7BF": { vendor: "TP-Link" },
  "AC84C6": { vendor: "TP-Link" },
  "9C53CD": { vendor: "Mist / Juniper", type: "ap" },

  // ---- Apple ----
  "001451": { vendor: "Apple" },
  "0017F2": { vendor: "Apple" },
  "0019E3": { vendor: "Apple" },
  "001EC2": { vendor: "Apple" },
  "002500": { vendor: "Apple" },
  "0026BB": { vendor: "Apple" },
  "3035AD": { vendor: "Apple" },
  "40A6D9": { vendor: "Apple" },
  "60FDA6": { vendor: "Apple" },
  "7CD1C3": { vendor: "Apple" },
  "8866A5": { vendor: "Apple" },
  "A45E60": { vendor: "Apple" },
  "ACBC32": { vendor: "Apple" },
  "F0DBF8": { vendor: "Apple" },
  "F80377": { vendor: "Apple" },

  // ---- PC / endpoint silicon & OEMs ----
  "000C29": { vendor: "VMware", type: "vm" },
  "005056": { vendor: "VMware", type: "vm" },
  "001C14": { vendor: "VMware", type: "vm" },
  "00155D": { vendor: "Microsoft Hyper-V", type: "vm" },
  "0003FF": { vendor: "Microsoft" },
  "485073": { vendor: "Microsoft (Surface)", type: "computer" },
  "00219B": { vendor: "Dell", type: "computer" },
  "0024E8": { vendor: "Dell", type: "computer" },
  "5CF9DD": { vendor: "Dell", type: "computer" },
  "B083FE": { vendor: "Dell", type: "computer" },
  "F8BC12": { vendor: "Dell", type: "computer" },
  "00216A": { vendor: "Intel" },
  "001517": { vendor: "Intel" },
  "3CA9F4": { vendor: "Intel" },
  "8C1645": { vendor: "Intel" },
  "A0A8CD": { vendor: "Intel" },
  "00FF20": { vendor: "Lenovo", type: "computer" },
  "54EE75": { vendor: "Lenovo", type: "computer" },
  "8CA982": { vendor: "Lenovo / Intel", type: "computer" },
  "1C1B0D": { vendor: "ASUSTek" },
  "AC220B": { vendor: "ASUSTek" },
  "001A92": { vendor: "ASUSTek" },
  "000EA6": { vendor: "ASUSTek" },
  "001CC0": { vendor: "Intel" },
  "0050BA": { vendor: "Realtek" },
  "525400": { vendor: "QEMU/KVM virtual", type: "vm" },
  "001D7E": { vendor: "Cisco-Linksys" },
  "C80AA9": { vendor: "Quanta" },

  // ---- Printers ----
  "000048": { vendor: "Epson", type: "printer" },
  "001801": { vendor: "Epson", type: "printer" },
  "A4EE57": { vendor: "Epson", type: "printer" },
  "0080A3": { vendor: "Lantronix (print server)", type: "printer" },
  "00007D": { vendor: "Brother", type: "printer" },
  "008077": { vendor: "Brother", type: "printer" },
  "30055C": { vendor: "Brother", type: "printer" },
  "001BA9": { vendor: "Brother", type: "printer" },
  "0000AA": { vendor: "Xerox", type: "printer" },
  "9C934E": { vendor: "Xerox", type: "printer" },
  "0000F0": { vendor: "Samsung (printer)", type: "printer" },
  "001599": { vendor: "Samsung" },
  "0021CC": { vendor: "Canon", type: "printer" },
  "002673": { vendor: "Canon", type: "printer" },
  "F4811E": { vendor: "Canon", type: "printer" },
  "000074": { vendor: "Ricoh", type: "printer" },
  "00266C": { vendor: "Ricoh", type: "printer" },
  "002586": { vendor: "Lexmark", type: "printer" },
  "0021B7": { vendor: "Lexmark", type: "printer" },
  "0040A7": { vendor: "Kyocera", type: "printer" },
  "001D72": { vendor: "Kyocera", type: "printer" },
  "0020D6": { vendor: "Konica Minolta", type: "printer" },
  "00205A": { vendor: "Konica Minolta", type: "printer" },
  "0000B8": { vendor: "Zebra (label printer)", type: "printer" },
  "00074D": { vendor: "Zebra", type: "printer" },

  // ---- VoIP phones ----
  "0004F2": { vendor: "Polycom / Poly", type: "phone" },
  "64167F": { vendor: "Polycom / Poly", type: "phone" },
  "00907A": { vendor: "Polycom / Poly", type: "phone" },
  "805EC0": { vendor: "Yealink", type: "phone" },
  "001565": { vendor: "Yealink", type: "phone" },
  "000B82": { vendor: "Grandstream", type: "phone" },
  "C074AD": { vendor: "Grandstream", type: "phone" },
  "00085D": { vendor: "Aastra / Mitel", type: "phone" },

  // ---- Cameras / physical security ----
  "00408C": { vendor: "Axis Communications", type: "camera" },
  "ACCC8E": { vendor: "Axis Communications", type: "camera" },
  "B8A44F": { vendor: "Axis Communications", type: "camera" },
  "4419B6": { vendor: "Hikvision", type: "camera" },
  "BCAD28": { vendor: "Hikvision", type: "camera" },
  "C0561D": { vendor: "Hikvision", type: "camera" },
  "00408F": { vendor: "Dahua", type: "camera" },
  "3C1B4A": { vendor: "Dahua", type: "camera" },
  "001140": { vendor: "Avigilon", type: "camera" },

  // ---- Storage / NAS ----
  "0011D8": { vendor: "Synology", type: "storage" },
  "0024E9": { vendor: "Synology", type: "storage" },
  "001435": { vendor: "QNAP", type: "storage" },
  "245EBE": { vendor: "QNAP", type: "storage" },

  // ---- AV / IoT / consumer ----
  "B827EB": { vendor: "Raspberry Pi", type: "iot" },
  "DCA632": { vendor: "Raspberry Pi", type: "iot" },
  "E45F01": { vendor: "Raspberry Pi", type: "iot" },
  "2CF05D": { vendor: "Raspberry Pi", type: "iot" },
  "FCFC48": { vendor: "Amazon", type: "iot" },
  "44650D": { vendor: "Amazon", type: "iot" },
  "F0D2F1": { vendor: "Amazon", type: "iot" },
  "1CA0D3": { vendor: "Google / Nest", type: "iot" },
  "F4F5D8": { vendor: "Google", type: "iot" },
  "B0A737": { vendor: "Roku", type: "iot" },
  "CC6DA0": { vendor: "Roku", type: "iot" },
  "5CAAFD": { vendor: "Sonos", type: "iot" },
  "B8E937": { vendor: "Sonos", type: "iot" },
  "0017AB": { vendor: "Nintendo", type: "iot" },
  "0019C5": { vendor: "Sony", type: "iot" },
  "001315": { vendor: "Apple TV", type: "iot" },
  "001A11": { vendor: "Google", type: "iot" },
};

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

/** OUI → manufacturer, or null if not in the curated table. */
export function lookupVendor(mac: string | null | undefined): string | null {
  const p = macPrefix(mac);
  if (!p) return null;
  return OUI_TABLE[p]?.vendor ?? null;
}

function vendorTypeHint(mac: string | null | undefined): DeviceType | null {
  const p = macPrefix(mac);
  if (!p) return null;
  return OUI_TABLE[p]?.type ?? null;
}

/** Treat empty / "unknown" / "n/a" vendor strings as "no vendor". */
export function isBlankVendor(v: string | null | undefined): boolean {
  if (!v) return true;
  const s = v.trim().toLowerCase();
  return s === "" || s === "unknown" || s === "n/a" || s === "-" || s === "none";
}

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

/**
 * Best-effort device classification. Priority: SNMP sysDescr (most reliable) >
 * hostname keywords > OUI vendor hint > randomized-MAC heuristic > unknown.
 */
export function classifyDeviceType(input: {
  mac?: string | null;
  vendor?: string | null;
  hostname?: string | null;
  snmpSysDescr?: string | null;
}): DeviceType {
  const { mac, hostname, snmpSysDescr } = input;

  if (snmpSysDescr) {
    for (const r of SNMP_RULES) if (r.re.test(snmpSysDescr)) return r.type;
  }
  if (hostname) {
    for (const r of HOSTNAME_RULES) if (r.re.test(hostname)) return r.type;
  }
  const hint = vendorTypeHint(mac);
  if (hint) return hint;

  // Randomized/private MACs with no registry match are almost always phones or
  // laptops doing MAC privacy — call them mobile rather than unknown.
  if (isLocallyAdministered(mac) && !lookupVendor(mac)) return "mobile";

  return "unknown";
}

/** One-shot enrichment for a host row: fill vendor from OUI, classify type. */
export function enrichHost(input: {
  mac?: string | null;
  vendor?: string | null;
  hostname?: string | null;
  snmpSysDescr?: string | null;
}): { vendor: string | null; deviceType: DeviceType } {
  const vendor = isBlankVendor(input.vendor)
    ? lookupVendor(input.mac) ?? (input.vendor && !isBlankVendor(input.vendor) ? input.vendor : null)
    : (input.vendor ?? null);
  const deviceType = classifyDeviceType({ ...input, vendor });
  return { vendor, deviceType };
}
