/**
 * Scoreboard view-models for the Speed & Bandwidth page. Pure transforms over the
 * raw result rows (no I/O) so page.tsx stays readable: they turn newest-first
 * result lists into one compact card per sensor — latest numbers, a short trend
 * for the sparkline, and a traffic-light status with a human-readable reason.
 */
import type { SchoolIperfRow, SchoolSpeedtestRow } from "@/lib/iperf";

/** Line colors shared with the big chart's first two palette entries. */
export const DOWN_COLOR = "#2563eb"; // blue
export const UP_COLOR = "#16a34a"; // green

/** How many recent points feed a card's sparkline (oldest → newest). */
const TREND_POINTS = 24;

/** Status thresholds — named so the "why" tooltip can explain the dot. */
const HIGH_LATENCY_MS = 100;
const SLOW_FRACTION = 0.5; // a direction this far below its own recent best = warn
const HIGH_LOSS_PCT = 1;
const HIGH_RETRANSMITS = 100;

export type Tone = "ok" | "warn" | "bad";

export interface SpeedCardVM {
  sensorSlug: string;
  sensorName: string | null;
  ok: boolean;
  when: Date | null;
  downloadMbps: number | null;
  uploadMbps: number | null;
  latencyMs: number | null;
  jitterMs: number | null;
  provider: string | null;
  error: string | null;
  trendDown: number[];
  trendUp: number[];
  status: Tone;
  statusReason: string;
}

export interface IperfDir {
  mbps: number | null;
  ok: boolean;
  when: Date | null;
  error: string | null;
}

export interface IperfCardVM {
  sensorSlug: string;
  sensorName: string | null;
  down: IperfDir | null;
  up: IperfDir | null;
  protocol: string | null;
  retransmits: number | null;
  jitterMs: number | null;
  lossPct: number | null;
  trendDown: number[];
  trendUp: number[];
  status: Tone;
  statusReason: string;
  when: Date | null;
}

/** Newest-first values → last N in chronological order for a sparkline. */
function trend(valuesNewestFirst: number[]): number[] {
  return valuesNewestFirst.slice(0, TREND_POINTS).reverse();
}

/**
 * One internet card per sensor from its speed-test history (rows newest-first).
 * The first row per sensor is the latest result; older ok rows feed the trend
 * and the "recent best" the status compares against.
 */
export function buildInternetCards(rows: SchoolSpeedtestRow[]): SpeedCardVM[] {
  const order: string[] = [];
  const bySensor = new Map<string, SchoolSpeedtestRow[]>();
  for (const r of rows) {
    if (!bySensor.has(r.sensorSlug)) {
      bySensor.set(r.sensorSlug, []);
      order.push(r.sensorSlug);
    }
    bySensor.get(r.sensorSlug)!.push(r);
  }

  return order.map((slug) => {
    const list = bySensor.get(slug)!; // newest-first
    const latest = list[0];
    const okRows = list.filter((r) => r.ok);
    const trendDown = trend(
      okRows.filter((r) => r.downloadMbps != null).map((r) => r.downloadMbps as number),
    );
    const trendUp = trend(
      okRows.filter((r) => r.uploadMbps != null).map((r) => r.uploadMbps as number),
    );
    const bestDown = trendDown.length ? Math.max(...trendDown) : null;

    let status: Tone = "ok";
    let statusReason = "Healthy";
    if (!latest.ok) {
      status = "bad";
      statusReason = latest.error ? `Last test failed: ${latest.error}` : "Last test failed";
    } else if (latest.latencyMs != null && latest.latencyMs > HIGH_LATENCY_MS) {
      status = "warn";
      statusReason = `High latency (${latest.latencyMs.toFixed(0)} ms)`;
    } else if (
      bestDown != null &&
      latest.downloadMbps != null &&
      latest.downloadMbps < bestDown * SLOW_FRACTION
    ) {
      status = "warn";
      statusReason = `Download well below recent best (${bestDown.toFixed(0)} Mbps)`;
    }

    return {
      sensorSlug: slug,
      sensorName: latest.sensorName,
      ok: latest.ok,
      when: latest.startedAt ?? latest.createdAt,
      downloadMbps: latest.downloadMbps,
      uploadMbps: latest.uploadMbps,
      latencyMs: latest.latencyMs,
      jitterMs: latest.jitterMs,
      provider: latest.provider,
      error: latest.error,
      trendDown,
      trendUp,
      status,
      statusReason,
    };
  });
}

/**
 * One internal-throughput card per sensor from its iperf history (rows
 * newest-first). iperf runs one direction at a time, so the card pairs the
 * latest 'down' run with the latest 'up' run; the status flags loss, heavy
 * retransmits, or a direction running well below its own recent best.
 */
export function buildIperfCards(rows: SchoolIperfRow[]): IperfCardVM[] {
  const order: string[] = [];
  const bySensor = new Map<string, SchoolIperfRow[]>();
  for (const r of rows) {
    if (!bySensor.has(r.sensorSlug)) {
      bySensor.set(r.sensorSlug, []);
      order.push(r.sensorSlug);
    }
    bySensor.get(r.sensorSlug)!.push(r);
  }

  return order.map((slug) => {
    const list = bySensor.get(slug)!; // newest-first
    const latestDirRow = (dir: string) => list.find((r) => r.direction === dir) ?? null;
    const toDir = (r: SchoolIperfRow | null): IperfDir | null =>
      r == null
        ? null
        : {
            mbps: r.ok ? r.throughputMbps : null,
            ok: r.ok,
            when: r.startedAt ?? r.createdAt,
            error: r.error,
          };
    const downRow = latestDirRow("down");
    const upRow = latestDirRow("up");
    const down = toDir(downRow);
    const up = toDir(upRow);

    const okRows = list.filter((r) => r.ok && r.throughputMbps != null);
    const trendDown = trend(
      okRows.filter((r) => r.direction === "down").map((r) => r.throughputMbps as number),
    );
    const trendUp = trend(
      okRows.filter((r) => r.direction === "up").map((r) => r.throughputMbps as number),
    );
    // Latest run overall carries the representative protocol / retransmits / loss.
    const latest = list[0];
    const bestDown = trendDown.length ? Math.max(...trendDown) : null;
    const bestUp = trendUp.length ? Math.max(...trendUp) : null;

    let status: Tone = "ok";
    let statusReason = "Healthy";
    const haveOk = (down?.ok ?? false) || (up?.ok ?? false);
    if (!haveOk) {
      status = "bad";
      statusReason = latest?.error ? `Last run failed: ${latest.error}` : "Recent runs failed";
    } else if (latest?.lossPct != null && latest.lossPct > HIGH_LOSS_PCT) {
      status = "warn";
      statusReason = `Packet loss ${latest.lossPct.toFixed(1)}%`;
    } else if (latest?.retransmits != null && latest.retransmits > HIGH_RETRANSMITS) {
      status = "warn";
      statusReason = `High retransmits (${latest.retransmits})`;
    } else if (
      (down?.mbps != null && bestDown != null && down.mbps < bestDown * SLOW_FRACTION) ||
      (up?.mbps != null && bestUp != null && up.mbps < bestUp * SLOW_FRACTION)
    ) {
      status = "warn";
      statusReason = "A direction is running below its recent best";
    }

    const whenCandidates = [down?.when, up?.when].filter((d): d is Date => d != null);
    const when = whenCandidates.length
      ? whenCandidates.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b))
      : null;

    return {
      sensorSlug: slug,
      sensorName: latest?.sensorName ?? null,
      down,
      up,
      protocol: latest?.protocol ?? null,
      retransmits: latest?.retransmits ?? null,
      jitterMs: latest?.jitterMs ?? null,
      lossPct: latest?.lossPct ?? null,
      trendDown,
      trendUp,
      status,
      statusReason,
      when,
    };
  });
}
