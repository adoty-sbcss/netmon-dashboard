/**
 * Client-safe registry vocabulary (no DB / no OUI registry import). Safe to use
 * in client components for dropdowns and labels.
 */

/** CSV import/template columns (kept here so the "use server" import module and
 *  the template route can both reference it — server files can't export consts). */
export const CSV_COLUMNS = [
  "name",
  "device_type",
  "ip",
  "mac",
  "vendor",
  "model",
  "building",
  "room",
  "monitor_type",
  "snmp_community",
  "firmware_current",
  "status",
  "notes",
] as const;

export const MONITOR_TYPES = ["none", "icmp", "snmp", "wmi"] as const;
export type MonitorType = (typeof MONITOR_TYPES)[number];
export const MONITOR_TYPE_LABELS: Record<MonitorType, string> = {
  none: "None",
  icmp: "Ping (ICMP)",
  snmp: "SNMP",
  wmi: "WMI (Windows)",
};

export const REGISTRY_STATUSES = ["active", "maintenance", "eol", "retired"] as const;
export type RegistryStatus = (typeof REGISTRY_STATUSES)[number];
export const REGISTRY_STATUS_LABELS: Record<RegistryStatus, string> = {
  active: "Active",
  maintenance: "Maintenance",
  eol: "End-of-life",
  retired: "Retired",
};

/** Device types offered in the registry dropdown (curated subset + 'other'). */
export const REGISTRY_DEVICE_TYPES = [
  "switch",
  "router",
  "ap",
  "firewall",
  "server",
  "printer",
  "camera",
  "phone",
  "computer",
  "storage",
  "iot",
  "other",
] as const;
export type RegistryDeviceType = (typeof REGISTRY_DEVICE_TYPES)[number];
export const REGISTRY_DEVICE_TYPE_LABELS: Record<RegistryDeviceType, string> = {
  switch: "Switch",
  router: "Router",
  ap: "Access point",
  firewall: "Firewall",
  server: "Server",
  printer: "Printer",
  camera: "Camera",
  phone: "IP phone",
  computer: "Computer",
  storage: "Storage / NAS",
  iot: "IoT device",
  other: "Other",
};

export function isMonitorType(v: string): v is MonitorType {
  return (MONITOR_TYPES as readonly string[]).includes(v);
}
export function isRegistryStatus(v: string): v is RegistryStatus {
  return (REGISTRY_STATUSES as readonly string[]).includes(v);
}
export function isRegistryDeviceType(v: string): v is RegistryDeviceType {
  return (REGISTRY_DEVICE_TYPES as readonly string[]).includes(v);
}

/** Normalize a MAC for storage/matching: lowercase, colon-separated, or null. */
export function normalizeMac(mac: string | null | undefined): string | null {
  if (!mac) return null;
  const hex = mac.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
  if (hex.length !== 12) return mac.trim() || null;
  return hex.match(/.{2}/g)!.join(":");
}

/** The display label for a device's type, honoring the 'other' free-text. */
export function deviceTypeLabel(
  deviceType: string,
  deviceTypeOther: string | null,
): string {
  if (deviceType === "other") return deviceTypeOther?.trim() || "Other";
  return (
    REGISTRY_DEVICE_TYPE_LABELS[deviceType as RegistryDeviceType] ?? deviceType
  );
}
