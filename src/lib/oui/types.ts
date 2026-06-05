/**
 * Client-safe device-type vocabulary. Kept separate from ./index so UI
 * components can import the labels/enum WITHOUT pulling the ~1MB OUI registry
 * JSON into the browser bundle.
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
  | "media"
  | "display"
  | "iot"
  | "vm"
  | "randomized"
  | "unknown";

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
  media: "Media / TV",
  display: "Display / board",
  iot: "IoT",
  vm: "Virtual machine",
  randomized: "Randomized MAC",
  unknown: "Unknown",
};
