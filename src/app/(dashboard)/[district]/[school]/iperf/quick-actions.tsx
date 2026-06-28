"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  Gauge,
  Globe,
  Loader2,
  SlidersHorizontal,
} from "lucide-react";

import { runIperfAction, type IperfActionState } from "@/lib/iperf-actions";
import { runSpeedtestAction, type SpeedtestActionState } from "@/lib/speedtest-actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Superadmin toolbar on the school Speed & Bandwidth page: kick off an on-demand
 * speed test or iperf run, and jump straight to the schedule/settings — without
 * drilling into the per-sensor page first. Run actions queue a command that the
 * box executes on its next check-in (same actions the per-sensor panels use).
 */
export function IperfQuickActions({
  schoolPath,
  sensors,
}: {
  /** e.g. `/sbcss/rch` — used for revalidate + the per-sensor link. */
  schoolPath: string;
  sensors: { id: number; name: string }[];
}) {
  const [sensorId, setSensorId] = useState(sensors[0]?.id ?? 0);
  const [stState, runSpeedtest, stRunning] = useActionState<SpeedtestActionState, FormData>(
    runSpeedtestAction,
    {},
  );
  const [ipState, runIperf, ipRunning] = useActionState<IperfActionState, FormData>(
    runIperfAction,
    {},
  );

  if (sensors.length === 0) return null;

  const basePath = `${schoolPath}/iperf`;
  const msg = stState.error || stState.message || ipState.error || ipState.message;
  const isError = Boolean(stState.error || ipState.error);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm">
      <span className="font-medium text-muted-foreground">Quick actions:</span>

      {sensors.length > 1 && (
        <select
          value={sensorId}
          onChange={(e) => setSensorId(Number(e.target.value))}
          aria-label="Sensor"
          className="h-8 rounded-md border bg-background px-2 text-sm"
        >
          {sensors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}

      <form action={runSpeedtest}>
        <input type="hidden" name="sensorId" value={sensorId} />
        <input type="hidden" name="basePath" value={basePath} />
        <Button type="submit" size="sm" variant="outline" disabled={stRunning}>
          {stRunning ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Globe className="size-3.5" />
          )}
          Run speed test
        </Button>
      </form>

      <form action={runIperf}>
        <input type="hidden" name="sensorId" value={sensorId} />
        <input type="hidden" name="direction" value="down" />
        <input type="hidden" name="protocol" value="tcp" />
        <input type="hidden" name="duration" value="10" />
        <input type="hidden" name="basePath" value={basePath} />
        <Button type="submit" size="sm" variant="outline" disabled={ipRunning}>
          {ipRunning ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Gauge className="size-3.5" />
          )}
          Run iperf
        </Button>
      </form>

      <Button asChild size="sm" variant="outline">
        <Link href={`${schoolPath}/sensor/${sensorId}`}>
          <SlidersHorizontal className="size-3.5" /> Edit schedule
        </Link>
      </Button>

      {msg && (
        <span
          className={cn(
            "inline-flex items-center gap-1",
            isError ? "text-destructive" : "text-[var(--success)]",
          )}
        >
          {isError ? (
            <AlertCircle className="size-3.5" />
          ) : (
            <CheckCircle2 className="size-3.5" />
          )}
          {msg}
        </span>
      )}
    </div>
  );
}
