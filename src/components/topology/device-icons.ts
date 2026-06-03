/**
 * Tiny device-type "icon" tiles for the Cytoscape map: a white type-code drawn
 * in an SVG data URI (plain ASCII text rasterizes reliably in the canvas, unlike
 * emoji). Paired with a per-type background colour this reads as a labelled tile.
 */
const ABBR: Record<string, string> = {
  internet: "WAN",
  router: "RTR",
  gateway: "GW",
  scanner: "NM",
  switch: "SW",
  ap: "AP",
  firewall: "FW",
  server: "SRV",
  printer: "PRN",
  camera: "CAM",
  computer: "PC",
  phone: "PHN",
  mobile: "MOB",
  storage: "NAS",
  iot: "IOT",
  subnet: "NET",
  group: "•••",
  host: "PC",
  default: "?",
};

export function deviceAbbr(type: string): string {
  return ABBR[type] ?? ABBR.default;
}

export function iconUri(type: string): string {
  const t = deviceAbbr(type);
  const fontSize = t.length >= 3 ? 11 : 14;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="36">` +
    `<text x="22" y="24" font-family="-apple-system,Segoe UI,Roboto,sans-serif" ` +
    `font-size="${fontSize}" font-weight="700" fill="#ffffff" text-anchor="middle">${t}</text></svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}
