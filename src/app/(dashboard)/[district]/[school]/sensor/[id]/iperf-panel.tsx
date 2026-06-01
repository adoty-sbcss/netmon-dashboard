"use client";

import Link from "next/link";
import { useActionState } from "react";
import { CheckCircle2, AlertCircle, Gauge, Play } from "lucide-react";

import {
  runIperfAction,
  saveIperfScheduleAction,
  type IperfActionState,
} from "@/lib/iperf-actions";
import type { IperfResultRow } from "@/lib/iperf";
import { relativeTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function Notice({ state }: { state: IperfActionState }) {
  if (state.error)
    return (
      <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
        <AlertCircle className="size-4 shrink-0" /> {state.error}
      </p>
    );
  if (state.ok && state.message)
    return (
      <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-4 shrink-0" /> {state.message}
      </p>
    );
  return null;
}

const selectCls =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

export interface IperfSchedule {
  enabled: boolean;
  scheduleSec: number;
  duration: number;
  direction: string;
  protocol: string;
}

export function IperfPanel({
  sensorId,
  basePath,
  districtSlug,
  serverConfigured,
  serverLabel,
  schedule,
  results,
}: {
  sensorId: number;
  basePath: string;
  districtSlug: string;
  serverConfigured: boolean;
  serverLabel: string;
  schedule: IperfSchedule;
  results: IperfResultRow[];
}) {
  const [runState, runAction, running] = useActionState<IperfActionState, FormData>(
    runIperfAction,
    {},
  );
  const [schedState, schedAction, savingSched] = useActionState<IperfActionState, FormData>(
    saveIperfScheduleAction,
    {},
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Gauge className="size-4 text-primary" /> iperf3 throughput
          {serverConfigured && (
            <span className="text-sm font-normal text-muted-foreground">→ {serverLabel}</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!serverConfigured ? (
          <p className="text-sm text-muted-foreground">
            No iperf3 server configured for this district.{" "}
            <Link href={`/${districtSlug}/settings`} className="text-primary hover:underline">
              Set one in District settings →
            </Link>
          </p>
        ) : (
          <>
            {/* Run now */}
            <form action={runAction} className="flex flex-wrap items-end gap-2 border-b pb-4">
              <input type="hidden" name="sensorId" value={sensorId} />
              <input type="hidden" name="basePath" value={basePath} />
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Direction</label>
                <select name="direction" defaultValue="down" className={selectCls}>
                  <option value="down">Download (server→sensor)</option>
                  <option value="up">Upload (sensor→server)</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Protocol</label>
                <select name="protocol" defaultValue="tcp" className={selectCls}>
                  <option value="tcp">TCP</option>
                  <option value="udp">UDP</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Seconds</label>
                <Input name="duration" type="number" min={1} max={60} defaultValue={10} className="w-20" />
              </div>
              <Button type="submit" disabled={running}>
                <Play /> {running ? "Queuing…" : "Run now"}
              </Button>
              <Notice state={runState} />
            </form>

            {/* Schedule (pushed to the box via desired_config) */}
            <form action={schedAction} className="flex flex-col gap-3">
              <input type="hidden" name="sensorId" value={sensorId} />
              <input type="hidden" name="basePath" value={basePath} />
              <label className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  name="iperfEnabled"
                  defaultChecked={schedule.enabled}
                  className="size-4 rounded border-input accent-primary"
                />
                <span className="text-sm font-medium">Run on a schedule</span>
              </label>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Every (seconds)</label>
                  <Input name="scheduleSec" type="number" min={300} defaultValue={schedule.scheduleSec} className="w-28" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Direction</label>
                  <select name="direction" defaultValue={schedule.direction} className={selectCls}>
                    <option value="down">Download</option>
                    <option value="up">Upload</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Protocol</label>
                  <select name="protocol" defaultValue={schedule.protocol} className={selectCls}>
                    <option value="tcp">TCP</option>
                    <option value="udp">UDP</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Seconds</label>
                  <Input name="duration" type="number" min={1} max={60} defaultValue={schedule.duration} className="w-20" />
                </div>
                <Button type="submit" variant="outline" disabled={savingSched}>
                  {savingSched ? "Saving…" : "Save schedule"}
                </Button>
              </div>
              <Notice state={schedState} />
              <p className="text-xs text-muted-foreground">
                Pushed to the box on its next check-in (via desired config).
              </p>
            </form>
          </>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="px-3 py-2 text-left font-medium">When</th>
                  <th className="px-3 py-2 text-left font-medium">Dir</th>
                  <th className="px-3 py-2 text-left font-medium">Proto</th>
                  <th className="px-3 py-2 text-right font-medium">Mbps</th>
                  <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Retr</th>
                  <th className="hidden px-3 py-2 text-right font-medium md:table-cell">Jitter</th>
                  <th className="hidden px-3 py-2 text-right font-medium md:table-cell">Loss</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {relativeTime(r.startedAt ?? r.createdAt)}
                      <span className="ml-1.5 text-[10px] uppercase">{r.trigger}</span>
                    </td>
                    <td className="px-3 py-1.5">{r.direction ?? "—"}</td>
                    <td className="px-3 py-1.5 uppercase">{r.protocol ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                      {r.ok && r.throughputMbps != null ? r.throughputMbps.toFixed(1) : (
                        <span className="text-destructive" title={r.error ?? undefined}>failed</span>
                      )}
                    </td>
                    <td className="hidden px-3 py-1.5 text-right tabular-nums sm:table-cell">
                      {r.retransmits ?? "—"}
                    </td>
                    <td className="hidden px-3 py-1.5 text-right tabular-nums md:table-cell">
                      {r.jitterMs != null ? `${r.jitterMs.toFixed(1)}ms` : "—"}
                    </td>
                    <td className="hidden px-3 py-1.5 text-right tabular-nums md:table-cell">
                      {r.lossPct != null ? `${r.lossPct.toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
