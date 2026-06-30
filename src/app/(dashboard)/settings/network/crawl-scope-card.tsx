"use client";

import { useActionState } from "react";
import { AlertCircle, CheckCircle2, Radar } from "lucide-react";

import { bulkSetCrawlScopeAction, type SensorActionState } from "@/lib/admin/sensor-actions";
import type { DistrictRolloutRow } from "@/db/settings-queries";
import { relativeTime, titleizeSlug } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/section-header";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const selectCls =
  "h-9 w-full max-w-md rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/50";

/** Has the box applied the latest pushed config (which carries the crawl scope)? */
function rollout(
  reportedV: number | null,
  desiredV: number | null,
): { label: string; cls: string } {
  if (desiredV == null) return { label: "no config pushed", cls: "text-muted-foreground" };
  if (reportedV != null && reportedV >= desiredV)
    return { label: "synced", cls: "border-[var(--success)] text-[var(--success)]" };
  return { label: "pending", cls: "border-[var(--warning)] text-[var(--warning)]" };
}

/**
 * District-scoped topology-crawl scope/tuning card on /settings/network. Pushes
 * the crawl scope (Full / Spine) + tuning to every sensor in THIS district, then
 * shows each box applying it on its next check-in. → bulkSetCrawlScopeAction.
 */
export function CrawlScopeCard({
  districtId,
  basePath,
  rows,
}: {
  districtId: number;
  basePath: string;
  rows: DistrictRolloutRow[];
}) {
  const [state, action, pending] = useActionState<SensorActionState, FormData>(
    bulkSetCrawlScopeAction,
    {},
  );
  const pendingCount = rows.filter(
    (r) => rollout(r.reportedConfigVersion, r.desiredVersion).label === "pending",
  ).length;

  return (
    <Card>
      <SectionHeader icon={Radar} title="Crawl scope & tuning" />
      <CardContent className="flex flex-col gap-4">
        <form action={action} className="flex max-w-xl flex-col gap-3">
          <input type="hidden" name="districtId" value={districtId} />
          <input type="hidden" name="basePath" value={basePath} />
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
              {pending
                ? "Pushing…"
                : `Push to this district's ${rows.length} sensor${rows.length === 1 ? "" : "s"}`}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Merges into each box&apos;s existing config (SNMP/SFTP preserved) and bumps its
            version. Blank numeric fields keep each box&apos;s current value. Each box applies
            on its next check-in.
          </p>
        </form>

        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border">
            <div className="px-3 py-2 text-xs text-muted-foreground">
              Rollout —{" "}
              {pendingCount === 0
                ? "all sensors are on their latest pushed config"
                : `${pendingCount} sensor(s) have not applied the latest config yet`}
              .
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sensor</TableHead>
                  <TableHead>Pushed scope</TableHead>
                  <TableHead>Config (reported / desired)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Reported</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const st = rollout(r.reportedConfigVersion, r.desiredVersion);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        {r.name || titleizeSlug(r.slug)}
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {r.schoolSlug}/{r.slug}
                        </span>
                      </TableCell>
                      <TableCell className="capitalize">{r.pushedScope || "—"}</TableCell>
                      <TableCell className="tabular-nums">
                        {r.reportedConfigVersion != null ? `v${r.reportedConfigVersion}` : "—"}
                        {" / "}
                        {r.desiredVersion != null ? `v${r.desiredVersion}` : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={st.cls}>{st.label}</Badge>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {r.reportedConfigAt ? relativeTime(r.reportedConfigAt) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
