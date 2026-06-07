/**
 * Remote-console (browser SSH-like) shared config.
 *
 * The broker is a stable Container App on the default CAE FQDN. It's not a
 * secret — the operator's browser connects to it directly — so it's fine to
 * surface to the client. Override via BROKER_WSS_URL if the CAE is ever rebuilt
 * (the FQDN's `calmsky-…` infix is the environment's, and would change).
 */
export const BROKER_WSS_URL =
  process.env.BROKER_WSS_URL ??
  "wss://w2-sbcss-netmon-broker.calmsky-2d8ef65b.westus2.azurecontainerapps.io/console";

/**
 * Restricted-command posture: the ONLY commands that may flow operator -> sensor
 * over a live console. Mirrors the collector's _DIAG_COMMANDS registry and the
 * broker's allow-list (defense in depth — the sensor is the source of truth and
 * re-validates every id). State-changing commands are intentionally excluded.
 */
export const CONSOLE_COMMANDS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "diag-interfaces", label: "Interfaces" },
  { id: "diag-routes", label: "Routes" },
  { id: "diag-arp", label: "ARP table" },
  { id: "diag-dns", label: "DNS check" },
  { id: "diag-disk", label: "Disk" },
  { id: "diag-uptime", label: "Uptime" },
  { id: "diag-selftest", label: "Selftest" },
];

/** Hard session ceiling, mirrored on the broker. */
export const CONSOLE_TTL_MS = 15 * 60 * 1000;
