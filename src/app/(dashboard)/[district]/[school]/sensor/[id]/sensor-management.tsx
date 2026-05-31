"use client";

import { useActionState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  RefreshCw,
  Settings2,
  Terminal,
  UploadCloud,
} from "lucide-react";

import {
  enrollSensorAction,
  saveSensorConfigAction,
  queueCommandAction,
  type SensorActionState,
} from "@/lib/admin/sensor-actions";
import type { SensorManagement } from "@/db/queries";
import { dateTime, relativeTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function Notice({ state }: { state: SensorActionState }) {
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

const STATUS_TONE: Record<string, string> = {
  done: "text-[var(--success)]",
  failed: "text-destructive",
  sent: "text-[var(--info,#3b82f6)]",
};

export function SensorManagementPanel({
  sensorId,
  basePath,
  mgmt,
}: {
  sensorId: number;
  basePath: string;
  mgmt: SensorManagement;
}) {
  const [enrollState, enrollAction, enrolling] = useActionState<SensorActionState, FormData>(
    enrollSensorAction,
    {},
  );
  const [cfgState, cfgAction, savingCfg] = useActionState<SensorActionState, FormData>(
    saveSensorConfigAction,
    {},
  );
  const [cmdState, cmdAction, queuing] = useActionState<SensorActionState, FormData>(
    queueCommandAction,
    {},
  );

  const cfg = mgmt.config ?? {};
  const snmpCommunities = String((cfg.snmp_communities as string) ?? "");
  const snmpEnabled = Boolean(cfg.snmp_enabled);
  const rescan = cfg.rescan_interval as number | undefined;
  const labelCls = "text-sm font-medium";

  return (
    <div className="flex flex-col gap-6">
      {/* Enrollment */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4 text-primary" />
            Enrollment
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {mgmt.enrolled ? (
              <Badge variant="outline" className="border-[var(--success)] text-[var(--success)]">enrolled</Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">not enrolled</Badge>
            )}
            <span className="text-muted-foreground">
              {mgmt.enrollLastUsedAt ? `last check-in ${relativeTime(mgmt.enrollLastUsedAt)}` : "no check-in yet"}
            </span>
          </div>
          {enrollState.token && (
            <div className="rounded-lg border border-[var(--warning)]/50 bg-[var(--warning)]/5 p-3">
              <p className="text-sm font-medium">Enrollment token (copy now — shown once):</p>
              <code className="mt-1 block break-all rounded bg-muted px-2 py-1.5 font-mono text-xs select-all">
                {enrollState.token}
              </code>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Put it in the sensor&apos;s <code>/etc/netmon/netmon.env</code> as
                <code> NETMON_ENROLL_TOKEN</code>, alongside <code>NETMON_DASHBOARD_URL</code>.
              </p>
            </div>
          )}
          <Notice state={enrollState} />
          <form action={enrollAction}>
            <input type="hidden" name="sensorId" value={sensorId} />
            <input type="hidden" name="basePath" value={basePath} />
            <Button type="submit" variant={mgmt.enrolled ? "outline" : "default"} disabled={enrolling}>
              <RefreshCw className={enrolling ? "size-4 animate-spin" : "size-4"} />
              {enrolling ? "Generating…" : mgmt.enrolled ? "Re-enroll (rotate token)" : "Enroll sensor"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Desired config */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings2 className="size-4 text-primary" />
            Configuration
            {mgmt.configVersion != null && (
              <span className="text-sm font-normal text-muted-foreground">desired v{mgmt.configVersion}</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form action={cfgAction} className="flex flex-col gap-4">
            <input type="hidden" name="sensorId" value={sensorId} />
            <input type="hidden" name="basePath" value={basePath} />
            <label className="flex items-center gap-2.5">
              <input
                type="checkbox"
                name="snmpEnabled"
                defaultChecked={snmpEnabled}
                className="size-4 rounded border-input accent-primary"
              />
              <span className={labelCls}>SNMP enabled</span>
            </label>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="snmpCommunities" className={labelCls}>SNMP community strings</label>
              <Input
                id="snmpCommunities"
                name="snmpCommunities"
                defaultValue={snmpCommunities}
                placeholder="public, mystring2"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">Comma-separated; tried in order during SNMP polling.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="rescanInterval" className={labelCls}>Scan interval (seconds, optional)</label>
              <Input
                id="rescanInterval"
                name="rescanInterval"
                type="number"
                min={60}
                defaultValue={rescan ?? ""}
                placeholder="3600"
                className="max-w-[12rem]"
              />
            </div>
            <Notice state={cfgState} />
            <div>
              <Button type="submit" disabled={savingCfg}>
                {savingCfg ? "Saving…" : "Save configuration"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Commands */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Terminal className="size-4 text-primary" />
            Commands
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {[
              { cmd: "run-scan", label: "Force scan", icon: RefreshCw },
              { cmd: "upload-now", label: "Force upload", icon: UploadCloud },
              { cmd: "config-backup", label: "Back up config now", icon: KeyRound },
            ].map(({ cmd, label, icon: Icon }) => (
              <form action={cmdAction} key={cmd}>
                <input type="hidden" name="sensorId" value={sensorId} />
                <input type="hidden" name="basePath" value={basePath} />
                <input type="hidden" name="command" value={cmd} />
                <Button type="submit" variant="outline" size="sm" disabled={queuing}>
                  <Icon className="size-4" /> {label}
                </Button>
              </form>
            ))}
          </div>
          <Notice state={cmdState} />
          <p className="text-xs text-muted-foreground">
            Queued commands run on the sensor&apos;s next check-in (within the poll interval).
          </p>

          {mgmt.commands.length > 0 && (
            <div className="mt-1 overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="px-3 py-2 text-left font-medium">Command</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                    <th className="hidden px-3 py-2 text-left font-medium sm:table-cell">Queued</th>
                    <th className="hidden px-3 py-2 text-left font-medium md:table-cell">Sent</th>
                  </tr>
                </thead>
                <tbody>
                  {mgmt.commands.map((c) => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="px-3 py-2 font-mono text-xs">{c.command}</td>
                      <td className={`px-3 py-2 ${STATUS_TONE[c.status] ?? "text-muted-foreground"}`}>{c.status}</td>
                      <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell" title={dateTime(c.createdAt)}>
                        {relativeTime(c.createdAt)}
                      </td>
                      <td className="hidden px-3 py-2 text-muted-foreground md:table-cell">
                        {c.sentAt ? relativeTime(c.sentAt) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
