/**
 * sysObjectID → vendor decode. A device's SNMP sysObjectID (1.3.6.1.2.1.1.2.0)
 * is an OID under the vendor's IANA Private Enterprise Number:
 * `1.3.6.1.4.1.<PEN>.…`. The PEN alone reliably identifies the MANUFACTURER of
 * any SNMP-speaking device — a strong, cheap identity signal for managed gear
 * that complements OUI (which can be a reseller) and ENTITY-MIB model strings.
 *
 * We map the PEN → vendor (broad coverage); exact model decode is left to
 * ENTITY-MIB (entPhysicalModelName), which gives clean model strings already.
 * Pure + client-safe (no imports) so the classifier, ingest, and UI can share it.
 */

/** IANA Private Enterprise Number → manufacturer. The common K-12 / enterprise
 *  network, security, storage, AV, and power vendors. Extend as needed. */
export const ENTERPRISE_VENDORS: Record<number, string> = {
  9: "Cisco",
  11: "HP / HPE",
  14823: "Aruba Networks",
  2636: "Juniper Networks",
  30065: "Arista Networks",
  12356: "Fortinet",
  25461: "Palo Alto Networks",
  41112: "Ubiquiti",
  29671: "Cisco Meraki",
  4526: "Netgear",
  674: "Dell",
  1588: "Brocade",
  1916: "Extreme Networks",
  1991: "Extreme Networks", // (Foundry, now Extreme)
  25053: "Ruckus / CommScope",
  14988: "MikroTik",
  21067: "Sophos",
  8741: "SonicWall",
  3097: "WatchGuard",
  6574: "Synology",
  24681: "QNAP",
  368: "Axis Communications",
  39165: "Hikvision",
  1004: "Dahua", // (best-effort; verify if it shows up)
  6876: "VMware",
  311: "Microsoft",
  318: "APC / Schneider",
  3808: "CyberPower",
  13885: "Polycom / Poly",
  534: "Eaton",
  2011: "Huawei",
  890: "Zyxel",
  3375: "F5 Networks",
  5951: "NetScaler / Citrix",
};

export interface SysObjectIdInfo {
  pen: number;
  vendor: string;
}

/** Decode a sysObjectID OID → { pen, vendor }, or null if not an enterprise OID
 *  or an unknown PEN. Tolerates a leading dot and trailing model components. */
export function decodeSysObjectId(raw: string | null | undefined): SysObjectIdInfo | null {
  if (!raw) return null;
  const m = raw.replace(/^\./, "").match(/^1\.3\.6\.1\.4\.1\.(\d+)(?:\.|$)/);
  if (!m) return null;
  const pen = Number(m[1]);
  const vendor = ENTERPRISE_VENDORS[pen];
  return vendor ? { pen, vendor } : null;
}
