import type { ComponentType } from "react";
import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, Clock } from "lucide-react";

import { dateTime, relativeTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/status-dot";
import { Sparkline } from "@/components/sparkline";
import { DOWN_COLOR, UP_COLOR, type SpeedCardVM } from "./summary";

function f1(v: number | null | undefined): string {
  return v == null ? "—" : v.toFixed(1);
}

function Metric({
  label,
  value,
  max,
  tone,
  Icon,
}: {
  label: string;
  value: number | null;
  max: number;
  tone: string;
  Icon: ComponentType<{ className?: string }>;
}) {
  const pct = value != null && max > 0 ? Math.max(3, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon className="size-3.5" /> {label}
        </span>
        <span className="text-xl font-semibold tabular-nums leading-none">
          {f1(value)} <span className="text-xs font-normal text-muted-foreground">Mbps</span>
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * "Latest internet speed" cards — one per sensor, showing the most recent public
 * speed test as big download/upload numbers with proportional bars, a health dot,
 * a 24h sparkline, and latency/jitter chips. Presentational (server-rendered);
 * the historical trend chart lives below it on the page.
 */
export function SpeedtestLatest({ items }: { items: SpeedCardVM[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {items.map((r) => {
        const max = Math.max(r.downloadMbps ?? 0, r.uploadMbps ?? 0, 1);
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
            {!r.ok ? (
              <p className="text-sm text-destructive">
                Failed{r.error ? ` — ${r.error}` : ""}{" "}
                <Link
                  href="/help/read-speed-and-bandwidth"
                  className="whitespace-nowrap font-medium text-primary hover:underline"
                >
                  Why? →
                </Link>
              </p>
            ) : (
              <>
                <Metric label="Download" value={r.downloadMbps} max={max} tone="bg-blue-500" Icon={ArrowDownToLine} />
                <Metric label="Upload" value={r.uploadMbps} max={max} tone="bg-emerald-500" Icon={ArrowUpFromLine} />
                {hasTrend && (
                  <Sparkline
                    series={[
                      { points: r.trendDown, color: DOWN_COLOR },
                      { points: r.trendUp, color: UP_COLOR },
                    ]}
                    className="mt-0.5"
                  />
                )}
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  <Badge variant="outline" className="text-[11px] font-normal">
                    latency {f1(r.latencyMs)} ms
                  </Badge>
                  <Badge variant="outline" className="text-[11px] font-normal">
                    jitter {f1(r.jitterMs)} ms
                  </Badge>
                  {r.provider && (
                    <Badge variant="outline" className="text-[11px] font-normal capitalize">
                      {r.provider}
                    </Badge>
                  )}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
