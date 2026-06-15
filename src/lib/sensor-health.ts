/**
 * Sensor health flags — the tripwire that would have surfaced Trona's silent
 * freeze in days instead of by accident. Pure function over data we already
 * collect at check-in, so it flags BOTH new-code boxes (via lastUpdate) and
 * old-code boxes (via a blank/stale commit SHA or a check-in-without-fresh-data
 * gap). Used by the fleet view + the sensor detail page.
 */

import { asDate } from "./format";

export type HealthLevel = "error" | "warn";

export interface HealthFlag {
  code: string;
  level: HealthLevel;
  label: string;
  detail?: string;
  /** Help Center article slug that explains/fixes this flag (for a "Fix this →" link). */
  help?: string;
}

/** Which Help Center article each flag points at (the "meet them at the problem" link). */
const HELP_FOR: Record<string, string> = {
  never_checkin: "sensor-health-needs-attention",
  offline: "sensor-health-needs-attention",
  late_checkin: "sensor-health-needs-attention",
  update_failed: "recover-stuck-sensor",
  update_rolled_back: "recover-stuck-sensor",
  no_version: "recover-stuck-sensor",
  behind_fleet: "recover-stuck-sensor",
  no_data_ever: "fix-automatic-sftp-upload",
  stalled_data: "fix-automatic-sftp-upload",
  config_pending: "school-and-district-settings",
};

export interface SensorHealthInput {
  lastCheckinAt: Date | null;
  reportedSha: string | null;
  lastUpdateStatus: string | null;
  lastUpdateReason: string | null;
  /** desired config version (what we want applied) */
  configVersion: number | null;
  /** applied config version the box reports */
  reportedConfigVersion: number | null;
  /** latest scan that reached the dashboard (ground truth for "producing data") */
  lastScanAt: Date | null;
}

const MIN = 60_000;
const HOUR = 60 * MIN;

function ageText(at: Date | null): string {
  if (!at) return "never";
  const ms = Date.now() - at.getTime();
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MIN))}m ago`;
  if (ms < 48 * HOUR) return `${Math.round(ms / HOUR)}h ago`;
  return `${Math.round(ms / (24 * HOUR))}d ago`;
}

/**
 * Compute the attention flags for one sensor. `fleetTopSha` is the commit most of
 * the fleet is on (the de-facto current release) — a box on a different SHA is
 * "behind" (or a canary). Thresholds lean toward `warn` to stay non-noisy;
 * `error` is reserved for clearly-broken states.
 */
export function sensorHealthFlags(
  s: SensorHealthInput,
  opts: { fleetTopSha?: string | null } = {},
): HealthFlag[] {
  // Defensive coercion: lastScanAt/lastCheckinAt are typed Date but can arrive as
  // ISO strings when sourced from a SQL aggregate (drizzle's raw sql<Date> drops
  // the driver decoder) — normalize so the .getTime() math below can't throw and
  // 500 the page (this is the class of bug that took down Sensors). See asDate().
  const lastCheckinAt = asDate(s.lastCheckinAt);
  const lastScanAt = asDate(s.lastScanAt);
  const flags: HealthFlag[] = [];
  const now = Date.now();
  const checkinMs = lastCheckinAt ? now - lastCheckinAt.getTime() : Infinity;
  const online = checkinMs <= 15 * MIN;

  // --- reachability ---
  if (!lastCheckinAt) {
    flags.push({ code: "never_checkin", level: "error", label: "Never checked in" });
  } else if (checkinMs > HOUR) {
    flags.push({
      code: "offline",
      level: "error",
      label: "Offline",
      detail: `no check-in for ${ageText(lastCheckinAt)}`,
    });
  } else if (checkinMs > 20 * MIN) {
    flags.push({
      code: "late_checkin",
      level: "warn",
      label: "Late check-in",
      detail: `last check-in ${ageText(lastCheckinAt)}`,
    });
  }

  // --- update health (new-code boxes report this) ---
  if (s.lastUpdateStatus === "failed") {
    flags.push({
      code: "update_failed",
      level: "error",
      label: "Update failing",
      detail: s.lastUpdateReason ?? undefined,
    });
  } else if (s.lastUpdateStatus === "rolled_back") {
    flags.push({
      code: "update_rolled_back",
      level: "warn",
      label: "Update rolled back",
      detail: s.lastUpdateReason ?? undefined,
    });
  }

  // --- version drift (catches old-code boxes whose git/update silently froze:
  //     a blank SHA means auto-update never even recorded a commit) ---
  if (online) {
    if (!s.reportedSha) {
      flags.push({
        code: "no_version",
        level: "warn",
        label: "No version reported",
        detail: "auto-update never recorded a commit — its git/update step is likely failing",
      });
    } else if (opts.fleetTopSha && s.reportedSha !== opts.fleetTopSha) {
      flags.push({
        code: "behind_fleet",
        level: "warn",
        label: "Behind the fleet",
        detail: `on ${s.reportedSha.slice(0, 8)}, fleet is on ${opts.fleetTopSha.slice(0, 8)}`,
      });
    }
  }

  // --- producing data? online but no recent scan reaching us = scanning or
  //     upload is stalled (this is exactly how Trona's SFTP-off state looked) ---
  if (online) {
    const scanMs = lastScanAt ? now - lastScanAt.getTime() : Infinity;
    if (!lastScanAt) {
      flags.push({
        code: "no_data_ever",
        level: "warn",
        label: "No data received",
        detail: "checking in, but no scan has ever reached the dashboard (uploads off?)",
      });
    } else if (scanMs > 6 * HOUR) {
      flags.push({
        code: "stalled_data",
        level: "warn",
        label: "No fresh data",
        detail: `online, but last scan reached us ${ageText(lastScanAt)} — scanning or upload is stalled`,
      });
    }
  }

  // --- config push stuck (applied < desired for a box that's checking in) ---
  if (
    online &&
    s.configVersion != null &&
    s.reportedConfigVersion != null &&
    s.reportedConfigVersion < s.configVersion
  ) {
    flags.push({
      code: "config_pending",
      level: "warn",
      label: "Config not applied",
      detail: `applied v${s.reportedConfigVersion} of v${s.configVersion}`,
    });
  }

  for (const f of flags) f.help = HELP_FOR[f.code];
  return flags;
}

/** The most severe level among flags, or null if healthy. */
export function worstLevel(flags: HealthFlag[]): HealthLevel | null {
  if (flags.some((f) => f.level === "error")) return "error";
  if (flags.some((f) => f.level === "warn")) return "warn";
  return null;
}

/**
 * The commit SHA most of the fleet runs — the de-facto current release. Used as
 * the "behind" reference. Ignores blank SHAs. Ties break by first seen.
 */
export function fleetTopSha(shas: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const sha of shas) {
    if (!sha) continue;
    counts.set(sha, (counts.get(sha) ?? 0) + 1);
  }
  let top: string | null = null;
  let best = 0;
  for (const [sha, n] of counts) {
    if (n > best) {
      best = n;
      top = sha;
    }
  }
  return top;
}
