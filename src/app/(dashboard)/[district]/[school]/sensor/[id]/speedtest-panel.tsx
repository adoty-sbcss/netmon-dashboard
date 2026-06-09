"use client";

import { useActionState } from "react";
import { CheckCircle2, AlertCircle, Globe, Play } from "lucide-react";

import {
  runSpeedtestAction,
  saveSpeedtestScheduleAction,
  type SpeedtestActionState,
} from "@/lib/speedtest-actions";
import type { SpeedtestResultRow } from "@/lib/iperf";
import { relativeTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function Notice({ state }: { state: SpeedtestActionState }) {
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

export interface SpeedtestSchedule {
  enabled: boolean;
  providers: string; // csv of ookla,cloudflare
  scheduleSec: number;
}

const f1 = (v: number | null) => (v == null ? "—" : v.toFixed(1));

export function SpeedtestPanel({
  sensorId,
  basePath,
  schedule,
  results,
}: {
  sensorId: number;
  basePath: string;
  schedule: SpeedtestSchedule;
  results: SpeedtestResultRow[];
}) {
  const [runState, runAction, running] = useActionState<SpeedtestActionState, FormData>(
    runSpeedtestAction,
    {},
  );
  const [schedState, schedAction, savingSched] = useActionState<SpeedtestActionState, FormData>(
    saveSpeedtestScheduleAction,
    {},
  );
  const provs = new Set(schedule.providers.split(",").map((p) => p.trim()));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Globe className="size-4 text-primary" /> Internet speed test
          <span className="text-sm font-normal text-muted-foreground">Ookla + Cloudflare</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Run now */}
        <form action={runAction} className="flex flex-wrap items-end gap-2 border-b pb-4">
          <input type="hidden" name="sensorId" value={sensorId} />
          <input type="hidden" name="basePath" value={basePath} />
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Provider</label>
            <select name="provider" defaultValue="" className={selectCls}>
              <option value="">Configured (both)</option>
              <option value="ookla">Ookla</option>
              <option value="cloudflare">Cloudflare</option>
            </select>
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
              name="speedtestEnabled"
              defaultChecked={schedule.enabled}
              className="size-4 rounded border-input accent-primary"
            />
            <span className="text-sm font-medium">Run on a schedule</span>
          </label>
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Every (seconds)</label>
              <Input
                name="scheduleSec"
                type="number"
                min={900}
                defaultValue={schedule.scheduleSec}
                className="w-28"
              />
            </div>
            <fieldset className="flex flex-col gap-1">
              <legend className="text-xs text-muted-foreground">Providers</legend>
              <div className="flex items-center gap-3 pt-1">
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    name="providerOokla"
                    defaultChecked={provs.has("ookla")}
                    className="size-4 rounded border-input accent-primary"
                  />
                  Ookla
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    name="providerCloudflare"
                    defaultChecked={provs.has("cloudflare")}
                    className="size-4 rounded border-input accent-primary"
                  />
                  Cloudflare
                </label>
              </div>
            </fieldset>
            <Button type="submit" variant="outline" disabled={savingSched}>
              {savingSched ? "Saving…" : "Save schedule"}
            </Button>
          </div>
          <Notice state={schedState} />
          <p className="text-xs text-muted-foreground">
            Pushed to the box on its next check-in (via desired config). Speed tests use
            real bandwidth — keep the interval reasonable (default 6h).
          </p>
        </form>

        {/* Results */}
        {results.length > 0 && (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="px-3 py-2 text-left font-medium">When</th>
                  <th className="px-3 py-2 text-left font-medium">Source</th>
                  <th className="px-3 py-2 text-right font-medium">↓ Down</th>
                  <th className="px-3 py-2 text-right font-medium">↑ Up</th>
                  <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Latency</th>
                  <th className="hidden px-3 py-2 text-right font-medium md:table-cell">Jitter</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {relativeTime(r.startedAt ?? r.createdAt)}
                      <span className="ml-1.5 text-[10px] uppercase">{r.trigger}</span>
                    </td>
                    <td className="px-3 py-1.5 capitalize">{r.provider ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                      {r.ok && r.downloadMbps != null ? (
                        `${f1(r.downloadMbps)}`
                      ) : (
                        <span className="text-destructive" title={r.error ?? undefined}>
                          failed
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {r.ok ? f1(r.uploadMbps) : "—"}
                    </td>
                    <td className="hidden px-3 py-1.5 text-right tabular-nums sm:table-cell">
                      {r.latencyMs != null ? `${f1(r.latencyMs)}ms` : "—"}
                    </td>
                    <td className="hidden px-3 py-1.5 text-right tabular-nums md:table-cell">
                      {r.jitterMs != null ? `${f1(r.jitterMs)}ms` : "—"}
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
