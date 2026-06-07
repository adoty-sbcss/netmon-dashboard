"use client";

import { Fragment, useActionState, useState } from "react";
import {
  AlertCircle,
  ArrowUpCircle,
  CheckCircle2,
  FileText,
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

/** Render a command result — log files as <pre>, anything else as JSON. */
function renderResult(result: Record<string, unknown>) {
  const entries = Object.entries(result);
  // Remote-console diagnostics return { command, exit, output } — show the
  // captured output as a terminal-style block.
  if (typeof result.output === "string") {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-[10px] text-muted-foreground">
          {String(result.command ?? "diagnostic")} · exit {String(result.exit ?? "?")}
        </p>
        <pre className="max-h-72 overflow-auto rounded bg-background p-2 text-[11px] leading-relaxed">
          {result.output || "(no output)"}
        </pre>
      </div>
    );
  }
  const logs = entries.filter(([k]) => k.toLowerCase().endsWith(".log"));
  if (logs.length > 0) {
    return (
      <div className="flex flex-col gap-2">
        {logs.map(([k, v]) => (
          <div key={k}>
            <p className="text-xs font-medium text-muted-foreground">{k}</p>
            <pre className="mt-1 max-h-72 overflow-auto rounded bg-background p-2 text-[11px] leading-relaxed">
              {String(v)}
            </pre>
          </div>
        ))}
      </div>
    );
  }
  return (
    <pre className="overflow-auto rounded bg-background p-2 text-[11px]">
      {JSON.stringify(result, null, 2)}
    </pre>
  );
}

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

  const [manageSftp, setManageSftp] = useState(false);
  const [openCmd, setOpenCmd] = useState<number | null>(null);

  const cfg = mgmt.config ?? {};
  const snmpCommunities = String((cfg.snmp_communities as string) ?? "");
  const snmpEnabled = Boolean(cfg.snmp_enabled);
  const rescan = cfg.rescan_interval as number | undefined;
  // Topology crawl (so 'spine' / 'full' + tuning flip from here — no SSH).
  const topoScope = String((cfg.snmp_topology_scope as string) ?? "full");
  const topoEnabled = Boolean(cfg.snmp_topology_enabled);
  const topoIntervalHours =
    cfg.snmp_topology_interval != null
      ? Math.round(Number(cfg.snmp_topology_interval) / 3600)
      : undefined;
  const topoMaxNodes = cfg.snmp_topology_max_nodes as number | undefined;
  const topoFanoutCap = cfg.snmp_topology_fanout_cap as number | undefined;
  const selectCls =
    "h-9 max-w-[18rem] rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/50";
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

            {/* Topology crawl scope + tuning (pushed to the box) */}
            <div className="rounded-lg border border-input p-3">
              <span className={labelCls}>Topology crawl</span>
              <div className="mt-3 flex flex-col gap-3">
                <label className="flex items-center gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    name="topoEnabled"
                    defaultChecked={topoEnabled}
                    className="size-4 rounded border-input accent-primary"
                  />
                  SNMP topology crawl enabled
                </label>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="topoScope" className={labelCls}>Crawl scope</label>
                  <select id="topoScope" name="topoScope" defaultValue={topoScope} className={selectCls}>
                    <option value="full">Full — crawl every neighbor (legacy)</option>
                    <option value="spine">Spine — follow only the path to the internet</option>
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Spine follows the uplink toward the gateway and stops at the edge — much
                    less clutter on multi-IDF sites. Switches a sensor isn&apos;t on the path
                    to show as <em>uncovered</em> on the map (add a sensor there).
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="topoIntervalHours" className="text-xs text-muted-foreground">Re-crawl every (hours)</label>
                    <Input id="topoIntervalHours" name="topoIntervalHours" type="number" min={0} defaultValue={topoIntervalHours ?? ""} placeholder="168" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="topoMaxNodes" className="text-xs text-muted-foreground">Max nodes</label>
                    <Input id="topoMaxNodes" name="topoMaxNodes" type="number" min={1} defaultValue={topoMaxNodes ?? ""} placeholder="600" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="topoFanoutCap" className="text-xs text-muted-foreground">Fan-out / device</label>
                    <Input id="topoFanoutCap" name="topoFanoutCap" type="number" min={1} defaultValue={topoFanoutCap ?? ""} placeholder="40" />
                  </div>
                </div>
                <input type="hidden" name="topoManage" value="1" />
                <p className="text-xs text-muted-foreground">
                  Blank numeric fields keep the box&apos;s current value. Applies on the next
                  check-in (the box restarts to load it).
                </p>
              </div>
            </div>

            {/* Push SFTP upload destination */}
            <div className="rounded-lg border border-input p-3">
              <label className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  name="sftpManage"
                  checked={manageSftp}
                  onChange={(e) => setManageSftp(e.target.checked)}
                  className="size-4 rounded border-input accent-primary"
                />
                <span className={labelCls}>Push SFTP upload settings to this box</span>
              </label>
              {manageSftp && (
                <div className="mt-3 flex flex-col gap-3">
                  <label className="flex items-center gap-2.5 text-sm">
                    <input type="checkbox" name="sftpEnabled" defaultChecked={Boolean(cfg.sftp_enabled)} className="size-4 rounded border-input accent-primary" />
                    SFTP uploads enabled
                  </label>
                  <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
                    <Input name="sftpHost" defaultValue={String((cfg.sftp_host as string) ?? "")} placeholder="sftp host" autoComplete="off" />
                    <Input name="sftpPort" type="number" defaultValue={Number((cfg.sftp_port as number) ?? 22)} placeholder="22" />
                  </div>
                  <Input name="sftpUser" defaultValue={String((cfg.sftp_user as string) ?? "")} placeholder="username" autoComplete="off" />
                  <Input name="sftpPassword" type="password" placeholder="password (blank = keep current)" autoComplete="new-password" />
                  <Input name="sftpRemotePath" defaultValue={String((cfg.sftp_remote_path as string) ?? "/")} placeholder="/" />
                  <p className="text-xs text-muted-foreground">
                    Pushed on the next check-in; the box restarts to apply. The password is stored in the control DB.
                  </p>
                </div>
              )}
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

      {/* Remote console — restricted, read-only diagnostics (no SSH). Each runs a
          fixed allow-listed command on the box; output appears in the command
          history below. State-changing actions are intentionally excluded. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Terminal className="size-4 text-primary" />
            Remote console
            <span className="text-xs font-normal text-muted-foreground">read-only diagnostics</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {[
              { cmd: "diag-interfaces", label: "Interfaces" },
              { cmd: "diag-routes", label: "Routes" },
              { cmd: "diag-arp", label: "ARP table" },
              { cmd: "diag-dns", label: "DNS check" },
              { cmd: "diag-disk", label: "Disk" },
              { cmd: "diag-uptime", label: "Uptime" },
              { cmd: "diag-selftest", label: "Selftest" },
            ].map(({ cmd, label }) => (
              <form action={cmdAction} key={cmd}>
                <input type="hidden" name="sensorId" value={sensorId} />
                <input type="hidden" name="basePath" value={basePath} />
                <input type="hidden" name="command" value={cmd} />
                <Button type="submit" variant="outline" size="sm" disabled={queuing}>{label}</Button>
              </form>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Runs on the box at its next check-in; the captured output shows in the command
            history below (click the row to expand). Real-time streaming via the tunnel
            broker is coming next.
          </p>
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
              { cmd: "collect-logs", label: "Collect logs", icon: FileText },
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
          {/* Code update — more consequential than the safe commands above, so
              it's separated with its own explanation. */}
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-input p-3">
            <form action={cmdAction}>
              <input type="hidden" name="sensorId" value={sensorId} />
              <input type="hidden" name="basePath" value={basePath} />
              <input type="hidden" name="command" value="update" />
              <Button type="submit" variant="outline" size="sm" disabled={queuing}>
                <ArrowUpCircle className="size-4" /> Update now
              </Button>
            </form>
            <p className="flex-1 text-xs text-muted-foreground">
              Pulls the latest release and rebuilds on the next check-in (≤ poll interval).
              The collector healthchecks and <strong>auto-rolls-back</strong> if the new build
              is unhealthy; the box reports its new version when it&apos;s back.
            </p>
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
                  {mgmt.commands.map((c) => {
                    const hasResult = c.result && Object.keys(c.result).length > 0;
                    const open = openCmd === c.id;
                    return (
                      <Fragment key={c.id}>
                        <tr
                          className={"border-b last:border-0 " + (hasResult ? "cursor-pointer hover:bg-accent/40" : "")}
                          onClick={() => hasResult && setOpenCmd(open ? null : c.id)}
                        >
                          <td className="px-3 py-2 font-mono text-xs">
                            {c.command}
                            {hasResult && <span className="ml-1.5 text-[10px] text-primary">view</span>}
                          </td>
                          <td className={`px-3 py-2 ${STATUS_TONE[c.status] ?? "text-muted-foreground"}`}>{c.status}</td>
                          <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell" title={dateTime(c.createdAt)}>
                            {relativeTime(c.createdAt)}
                          </td>
                          <td className="hidden px-3 py-2 text-muted-foreground md:table-cell">
                            {c.sentAt ? relativeTime(c.sentAt) : "—"}
                          </td>
                        </tr>
                        {open && hasResult && (
                          <tr className="bg-muted/30">
                            <td colSpan={4} className="px-3 py-2">
                              {renderResult(c.result!)}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
