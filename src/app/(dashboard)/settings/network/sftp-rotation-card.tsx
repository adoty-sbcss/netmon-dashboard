"use client";

import { useActionState } from "react";
import { AlertCircle, CheckCircle2, UploadCloud } from "lucide-react";

import { bulkSetSftpAction, type SensorActionState } from "@/lib/admin/sensor-actions";
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

/** Per-sensor rollout state: has the box applied the latest pushed config yet? */
function rollout(
  reportedV: number | null,
  desiredV: number | null,
): { label: string; cls: string } {
  if (desiredV == null)
    return { label: "no config pushed", cls: "text-muted-foreground" };
  if (reportedV != null && reportedV >= desiredV)
    return { label: "synced", cls: "border-[var(--success)] text-[var(--success)]" };
  return { label: "pending", cls: "border-[var(--warning)] text-[var(--warning)]" };
}

/**
 * District-scoped SFTP credential rotation card on /settings/network. Pushes one
 * SFTP destination to every sensor in THIS district, then shows each box flipping
 * to the new user before the old account is retired. → bulkSetSftpAction.
 */
export function SftpRotationCard({
  districtId,
  basePath,
  rows,
}: {
  districtId: number;
  basePath: string;
  rows: DistrictRolloutRow[];
}) {
  const [state, action, pending] = useActionState<SensorActionState, FormData>(
    bulkSetSftpAction,
    {},
  );
  const pendingCount = rows.filter(
    (r) => rollout(r.reportedConfigVersion, r.desiredVersion).label === "pending",
  ).length;

  return (
    <Card>
      <SectionHeader icon={UploadCloud} title="SFTP credential rotation" />
      <CardContent className="flex flex-col gap-4">
        <p className="max-w-xl text-sm text-muted-foreground">
          Push one SFTP destination to every sensor in this district, then watch each box flip to
          the new user before retiring the old account.
        </p>
        <form action={action} className="flex max-w-xl flex-col gap-3">
          <input type="hidden" name="districtId" value={districtId} />
          <input type="hidden" name="basePath" value={basePath} />
          <label className="flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              name="sftpEnabled"
              defaultChecked
              className="size-4 rounded border-input accent-primary"
            />
            SFTP uploads enabled
          </label>
          <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
            <Input name="sftpHost" placeholder="sftp host" autoComplete="off" required />
            <Input name="sftpPort" type="number" defaultValue={22} placeholder="22" />
          </div>
          <Input name="sftpUser" placeholder="username" autoComplete="off" required />
          <Input
            name="sftpPassword"
            type="password"
            placeholder="password (blank = keep each box's current)"
            autoComplete="new-password"
          />
          <Input name="sftpRemotePath" defaultValue="/" placeholder="/" />
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
            Merges into each box&apos;s existing config (SNMP etc. preserved) and bumps its
            version. Each box applies on its next check-in. Leave the password blank to rotate
            host/user without changing the password.
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
                  <TableHead className="hidden md:table-cell">Reported SFTP user</TableHead>
                  <TableHead className="hidden lg:table-cell">Reported host</TableHead>
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
                      <TableCell className="hidden font-mono text-xs md:table-cell">
                        {r.reportedSftpUser || "—"}
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs text-muted-foreground lg:table-cell">
                        {r.reportedSftpHost || "—"}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {r.reportedConfigVersion != null ? `v${r.reportedConfigVersion}` : "—"}
                        {" / "}
                        {r.desiredVersion != null ? `v${r.desiredVersion}` : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={st.cls}>
                          {st.label}
                        </Badge>
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
