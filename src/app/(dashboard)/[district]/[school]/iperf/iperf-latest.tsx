import type { ComponentType } from "react";
import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, Clock } from "lucide-react";

import { dateTime, relativeTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/status-dot";
import { Sparkline } from "@/components/sparkline";
import { DOWN_COLOR, UP_COLOR, type IperfCardVM, type IperfDir } from "./summary";

function f1(v: number | null | undefined): string {
  return v == null ? "—" : v.toFixed(1);
}

function IperfMetric({
  label,
  dir,
  max,
  tone,
  Icon,
}: {
  label: string;
  dir: IperfDir | null;
  max: number;
  tone: string;
  Icon: ComponentType<{ className?: string }>;
}) {
  const value = dir?.mbps ?? null;
  const failed = dir != null && !dir.ok;
  const pct = value != null && max > 0 ? Math.max(3, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon className="size-3.5" /> {label}
        </span>
        {failed ? (
          <span className="text-sm font-medium text-destructive">failed</span>
        ) : (
          <span className="text-xl font-semibold tabular-nums leading-none">
            {f1(value)} <span className="text-xs font-normal text-muted-foreground">Mbps</span>
          </span>
        )}
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${failed ? "bg-destructive/40" : tone}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * "Latest internal throughput" cards — the iperf counterpart to
 * {@link SpeedtestLatest}, one per sensor. iperf runs a single direction per run,
 * so each card pairs the latest 'down' run with the latest 'up' run as matching
 * download/upload bars, with a health dot, a sparkline, and protocol/retransmit/
 * loss chips. Shares the card language with the internet card so they read as a
 * side-by-side pair in the scoreboard.
 */
export function IperfLatest({ items }: { items: IperfCardVM[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {items.map((r) => {
        const max = Math.max(r.down?.mbps ?? 0, r.up?.mbps ?? 0, 1);
        const hasTrend = r.trendDown.length > 1 || r.trendUp.length > 1;
        return (
          <div key={r.sensorSlug} className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <StatusDot tone={r.status} title={r.statusReason} />
                <span className="truncate font-medium">{r.sensorName || r.sensorSlug}</span>
              </span>
              <span
                className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
                title={r.when ? dateTime(r.when) : undefined}
              >
                <Clock className="size-3" /> {r.when ? relativeTime(r.when) : "—"}
              </span>
            </div>
            <IperfMetric label="Download" dir={r.down} max={max} tone="bg-blue-500" Icon={ArrowDownToLine} />
            <IperfMetric label="Upload" dir={r.up} max={max} tone="bg-emerald-500" Icon={ArrowUpFromLine} />
            {hasTrend && (
              <Sparkline
                series={[
                  { points: r.trendDown, color: DOWN_COLOR },
                  { points: r.trendUp, color: UP_COLOR },
                ]}
                className="mt-0.5"
              />
            )}
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              {r.protocol && (
                <Badge variant="outline" className="text-[11px] font-normal uppercase">
                  {r.protocol}
                </Badge>
              )}
              {r.retransmits != null && (
                <Badge variant="outline" className="text-[11px] font-normal">
                  retr {r.retransmits}
                </Badge>
              )}
              {r.lossPct != null && (
                <Badge variant="outline" className="text-[11px] font-normal">
                  loss {r.lossPct.toFixed(1)}%
                </Badge>
              )}
              {r.jitterMs != null && (
                <Badge variant="outline" className="text-[11px] font-normal">
                  jitter {f1(r.jitterMs)} ms
                </Badge>
              )}
              {r.status === "bad" && (
                <Link
                  href="/help/read-speed-and-bandwidth"
                  className="text-[11px] font-medium text-primary hover:underline"
                >
                  Why? →
                </Link>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
