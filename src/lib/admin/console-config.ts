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

/**
 * State-changing console actions (CON-5). Mirrors the collector's
 * _CONTROL_COMMANDS + the broker allow-list. Unlike the read-only diagnostics
 * above, these CHANGE state on the box, so the UI gates each one behind an
 * explicit confirm and the action is audited. IN-CONTAINER scope only — host
 * actions (restart/reboot) need the host-execution path + security sign-off.
 * Keep this list short, safe, and reviewed with the security chat (SEC owner).
 */
export const CONSOLE_CONTROL_COMMANDS: ReadonlyArray<{
  id: string;
  label: string;
  /** Shown in the confirm prompt so the operator knows what will happen. */
  confirm: string;
}> = [
  {
    id: "ctl-flush-arp",
    label: "Flush ARP cache",
    confirm:
      "Flush the sensor's ARP/neighbor cache? Stale entries are cleared and re-learned on the next scan.",
  },
];

/**
 * Initial session budget once the sensor pairs, AND the increment added by each
 * "extend" (CON-6). The dashboard resets this clock to start at PAIRING (not at
 * click) so the up-to-10-min wait for the sensor's next check-in doesn't erode
 * the usable session. Mirrored on the broker.
 */
export const CONSOLE_TTL_MS = 15 * 60 * 1000;

/**
 * Absolute ceiling measured from session creation. Extends (+CONSOLE_TTL_MS
 * each) can never push a session past this. The broker enforces the same cap as
 * defense-in-depth. Keep these two in sync.
 */
export const CONSOLE_ABS_MAX_MS = 60 * 60 * 1000;
