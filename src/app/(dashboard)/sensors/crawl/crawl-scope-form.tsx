"use client";

import { useActionState } from "react";
import { AlertCircle, CheckCircle2, Radar } from "lucide-react";

import { bulkSetCrawlScopeAction, type SensorActionState } from "@/lib/admin/sensor-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const selectCls =
  "h-9 w-full max-w-md rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/50";

/** Fleet-wide topology crawl scope/tuning push (superadmin). → bulkSetCrawlScopeAction. */
export function CrawlScopeForm({ sensorCount }: { sensorCount: number }) {
  const [state, action, pending] = useActionState<SensorActionState, FormData>(
    bulkSetCrawlScopeAction,
    {},
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Radar className="size-4 text-primary" />
          Push crawl scope to all {sensorCount} sensor{sensorCount === 1 ? "" : "s"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex max-w-xl flex-col gap-3">
          <input type="hidden" name="basePath" value="/sensors/crawl" />
          <label className="flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              name="topoEnabled"
              defaultChecked
              className="size-4 rounded border-input accent-primary"
            />
            SNMP topology crawl enabled
          </label>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="topoScope" className="text-sm font-medium">Crawl scope</label>
            <select id="topoScope" name="topoScope" defaultValue="spine" className={selectCls}>
              <option value="full">Full — crawl every neighbor (legacy)</option>
              <option value="spine">Spine — follow only the path to the internet</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Spine follows the uplink toward the gateway and stops at the edge — much less
              clutter on multi-IDF sites. Switches a sensor isn&apos;t on the path to show as
              <em> uncovered</em> on the map (add a sensor there).
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="topoIntervalHours" className="text-xs text-muted-foreground">Re-crawl every (hours)</label>
              <Input id="topoIntervalHours" name="topoIntervalHours" type="number" min={0} placeholder="168" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="topoMaxNodes" className="text-xs text-muted-foreground">Max nodes</label>
              <Input id="topoMaxNodes" name="topoMaxNodes" type="number" min={1} placeholder="600" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="topoFanoutCap" className="text-xs text-muted-foreground">Fan-out / device</label>
              <Input id="topoFanoutCap" name="topoFanoutCap" type="number" min={1} placeholder="40" />
            </div>
          </div>
          {state.error && (
            <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
              <AlertCircle className="size-4 shrink-0" />
              {state.error}
            </p>
          )}
          {state.ok && state.message && (
            <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-4 shrink-0" />
              {state.message}
            </p>
          )}
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? "Pushing…" : "Push to all sensors"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Merges into each box&apos;s existing config (SNMP/SFTP preserved) and bumps its
            version. Blank numeric fields keep each box&apos;s current value. Each box applies
            on its next check-in.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
