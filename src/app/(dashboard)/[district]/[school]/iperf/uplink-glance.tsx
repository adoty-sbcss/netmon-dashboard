import { Network } from "lucide-react";

import { relativeTime } from "@/lib/format";

export interface UplinkGlanceProps {
  committedMbps: number | null;
  inMbps: number | null;
  outMbps: number | null;
  inPct: number | null;
  outPct: number | null;
  wanName: string | null;
  when: Date | null;
  portSpeedMbps: number | null;
}

function f1(v: number | null): string {
  return v == null ? "—" : v.toFixed(1);
}

/**
 * Compact WAN-utilization strip for the scoreboard: current in/out against the
 * committed rate as a single bar with an 80% alert marker. The detailed daily /
 * hourly charts and the sample table live in the full card lower on the page.
 */
export function UplinkGlance(p: UplinkGlanceProps) {
  const peak =
    p.inPct != null || p.outPct != null ? Math.max(p.inPct ?? 0, p.outPct ?? 0) : null;
  const fill = peak == null ? 0 : Math.min(100, peak);
  const barTone =
    peak == null
      ? "bg-muted-foreground/40"
      : peak >= 100
        ? "bg-destructive"
        : peak >= 80
          ? "bg-[var(--warning)]"
          : "bg-emerald-500";
  const pctTone = peak == null ? "" : peak >= 100 ? "text-destructive" : peak >= 80 ? "text-[var(--warning)]" : "";

  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Network className="size-4 text-primary" /> WAN utilization
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          ↓ {f1(p.inMbps)} · ↑ {f1(p.outMbps)} Mbps
          {p.committedMbps != null ? ` · vs ${p.committedMbps} committed` : ""}
        </span>
      </div>

      {p.committedMbps != null ? (
        <>
          <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted">
            <div className={`h-full rounded-full ${barTone}`} style={{ width: `${fill}%` }} />
            <span
              className="absolute -top-0.5 h-3.5 w-px bg-[var(--warning)]"
              style={{ left: "80%" }}
              aria-hidden="true"
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span className={`tabular-nums ${pctTone}`}>
              {peak == null ? "no rate yet" : `${peak.toFixed(0)}% of committed`}
            </span>
            <span className="truncate pl-2">
              {p.wanName ?? "—"}
              {p.when ? ` · ${relativeTime(p.when)}` : ""}
            </span>
          </div>
        </>
      ) : (
        <p className="text-xs text-[var(--warning)]">
          Set a committed rate (in the Uplink utilization card below) to see % used.
        </p>
      )}
    </div>
  );
}
