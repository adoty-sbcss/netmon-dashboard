import { Activity, Cpu, HardDrive, MemoryStick } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { relativeTime } from "@/lib/format";

/** Shape of the collector's host_metrics.collect() payload (all fields best-effort). */
type HostMetrics = {
  cpu?: { util_pct?: number | null; load1?: number | null; cores?: number | null };
  mem?: { total_mb?: number | null; used_mb?: number | null; used_pct?: number | null };
  disk?: {
    total_gb?: number | null;
    used_gb?: number | null;
    free_gb?: number | null;
    used_pct?: number | null;
    path?: string | null;
  };
  os?: { name?: string | null; version?: string | null; kernel?: string | null };
  uptimeSec?: number | null;
  tempC?: number | null;
};

function pctColor(pct: number | null | undefined): string {
  if (pct == null) return "var(--muted-foreground)";
  if (pct >= 90) return "var(--destructive)";
  if (pct >= 75) return "var(--warning)";
  return "var(--success)";
}

function fmtUptime(sec: number | null | undefined): string {
  if (sec == null) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Heartbeat from last-check-in age. Check-in cadence is ~10 min. */
function heartbeat(lastCheckinAt: Date | null): { label: string; cls: string } {
  if (!lastCheckinAt) return { label: "no check-in yet", cls: "border-muted text-muted-foreground" };
  const ageMs = Date.now() - new Date(lastCheckinAt).getTime();
  if (ageMs < 20 * 60_000)
    return { label: "online", cls: "border-[var(--success)] text-[var(--success)]" };
  if (ageMs < 2 * 3_600_000)
    return { label: "stale", cls: "border-[var(--warning)] text-[var(--warning)]" };
  return { label: "offline", cls: "border-[var(--destructive)] text-[var(--destructive)]" };
}

function Gauge({
  label,
  pct,
  detail,
  icon: Icon,
}: {
  label: string;
  pct: number | null | undefined;
  detail?: string;
  icon: typeof Cpu;
}) {
  const w = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Icon className="size-3.5" />
          {label}
        </span>
        <span className="font-medium tabular-nums">{pct == null ? "—" : `${pct.toFixed(0)}%`}</span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${w}%`, backgroundColor: pctColor(pct) }}
        />
      </div>
      {detail && <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 truncate ${mono ? "font-mono text-sm" : ""}`}>{value}</dd>
    </div>
  );
}

export function SensorHealthCard({
  metrics,
  metricsAt,
  lastCheckinAt,
}: {
  metrics: unknown;
  metricsAt: Date | null;
  lastCheckinAt: Date | null;
}) {
  const m = (metrics ?? {}) as HostMetrics;
  const hasData =
    metrics != null && typeof metrics === "object" && Object.keys(m).length > 0;
  const beat = heartbeat(lastCheckinAt);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Activity className="size-4 text-primary" />
          Sensor health
          <Badge variant="outline" className={beat.cls}>
            {beat.label}
          </Badge>
          {lastCheckinAt && (
            <span className="text-sm font-normal text-muted-foreground">
              checked in {relativeTime(lastCheckinAt)}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <p className="text-sm text-muted-foreground">
            No health metrics yet — the agent predates this feature or hasn&apos;t checked in
            since updating. Update the sensor to start reporting CPU / RAM / disk / OS.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Gauge
                icon={Cpu}
                label="CPU"
                pct={m.cpu?.util_pct ?? null}
                detail={
                  m.cpu?.load1 != null
                    ? `load ${m.cpu.load1}${m.cpu.cores ? ` · ${m.cpu.cores} cores` : ""}`
                    : undefined
                }
              />
              <Gauge
                icon={MemoryStick}
                label="Memory"
                pct={m.mem?.used_pct ?? null}
                detail={
                  m.mem?.used_mb != null && m.mem?.total_mb != null
                    ? `${(m.mem.used_mb / 1024).toFixed(1)} / ${(m.mem.total_mb / 1024).toFixed(1)} GB`
                    : undefined
                }
              />
              <Gauge
                icon={HardDrive}
                label="Disk"
                pct={m.disk?.used_pct ?? null}
                detail={
                  m.disk?.free_gb != null
                    ? `${m.disk.free_gb} GB free${m.disk.path ? ` · ${m.disk.path}` : ""}`
                    : undefined
                }
              />
            </div>
            <dl className="mt-5 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field
                label="OS"
                value={m.os?.name ? `${m.os.name}${m.os.version ? ` (${m.os.version})` : ""}` : "—"}
              />
              <Field label="Kernel" value={m.os?.kernel ?? "—"} mono />
              <Field label="Uptime" value={fmtUptime(m.uptimeSec)} />
              {m.tempC != null && <Field label="CPU temp" value={`${m.tempC} °C`} />}
              {metricsAt && <Field label="Measured" value={relativeTime(metricsAt)} />}
            </dl>
          </>
        )}
      </CardContent>
    </Card>
  );
}
