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
  { id: "diag-ping", label: "Ping internet" },
  { id: "diag-disk", label: "Disk" },
  { id: "diag-uptime", label: "Uptime" },
  { id: "diag-sftp-test", label: "Test SFTP" },
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
 * HOST-LEVEL maintenance actions (CON-5 host-execution path). Unlike the
 * diagnostics + in-container controls above, these run OUTSIDE the collector
 * container — the in-container agent records the request to a shared bind mount
 * and the host wrapper (scripts/host-action.sh) executes it. They are queued
 * (NOT sent over the live broker) and gated behind a TYPE-TO-CONFIRM prompt +
 * audit + a 'medium'/'high' security-feed event. Mirrors the collector's
 * checkin.py:_HOST_ACTIONS and scripts/host-action.sh allow-list.
 *
 * SECURITY: there is no second-approver flow yet (the check-in route only
 * dispatches requiresApproval=false commands and no approve-UI exists), so the
 * gate today is the typed confirm + audit. A real step-up/approver flow is a
 * security-chat follow-up (registry CON-5 / CON-7). Vet additions with security.
 */
export const HOST_ACTION_COMMANDS: ReadonlyArray<{
  id: string;
  label: string;
  /** Plain-language "when you'd use this" shown in the recommendations card. */
  when: string;
  /** Operator must type this exact word to arm the action. */
  confirmWord: string;
  /** Visual weight: 'reboot'/'rollback' are the heaviest. */
  danger: "amber" | "red";
}> = [
  {
    id: "host-restart",
    label: "Restart containers",
    when: "Collector is stuck/unresponsive but the code is fine — a quick `docker compose restart`. No rebuild, no data loss.",
    confirmWord: "RESTART",
    danger: "amber",
  },
  {
    id: "host-rebuild",
    label: "Rebuild containers",
    when: "After a bad image, a dependency change, or 'works on a fresh box but not this one'. Rebuilds the collector image and recreates it; keeps the database, config, and logs.",
    confirmWord: "REBUILD",
    danger: "amber",
  },
  {
    id: "host-rollback",
    label: "Roll back release",
    when: "A recent update made the box worse. Reverts code to the last-known-good commit + image + DB snapshot (scripts/rollback.sh).",
    confirmWord: "ROLLBACK",
    danger: "red",
  },
  {
    id: "host-reboot",
    label: "Reboot the box",
    when: "Last resort — kernel/driver/NIC weirdness that a container restart can't fix. The box goes down for a minute and comes back on its own.",
    confirmWord: "REBOOT",
    danger: "red",
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
