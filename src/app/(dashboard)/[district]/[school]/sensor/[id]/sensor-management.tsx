"use client";

import { Fragment, useActionState, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowUpCircle,
  CheckCircle2,
  KeyRound,
  RefreshCw,
  Settings2,
  Terminal,
  Wrench,
} from "lucide-react";

import {
  enrollSensorAction,
  queueCommandAction,
  queueHostActionAction,
  type SensorActionState,
} from "@/lib/admin/sensor-actions";
import { HOST_ACTION_COMMANDS } from "@/lib/admin/console-config";
import type { SensorManagement } from "@/db/queries";
import { RemoteConsoleLive } from "./console-live";
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

/**
 * Host-level maintenance & recovery actions (restart / rebuild / rollback /
 * reboot). These run OUTSIDE the container via the host wrapper, so they CAN'T
 * stream over the live console — they take the queued "near-live" path: recorded
 * now, executed by the host wrapper on the next check-in (within the poll
 * interval). Each is type-to-confirm gated + audited server-side. Rendered as a
 * section INSIDE the merged "Remote console and commands" card.
 */
function HostMaintenanceSection({ sensorId, basePath }: { sensorId: number; basePath: string }) {
  const [state, action, pending] = useActionState<SensorActionState, FormData>(
    queueHostActionAction,
    {},
  );
  const [confirmWord, setConfirmWord] = useState<Record<string, string>>({});

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Wrench className="size-4 text-primary" />
        <span className="text-sm font-medium">Maintenance &amp; recovery</span>
        <span className="text-xs text-muted-foreground">host-level — runs on next check-in</span>
      </div>
      <p className="text-xs text-muted-foreground">
        These run on the box itself (outside the collector container), so they can&apos;t stream
        live — they&apos;re recorded now and the host applies them on the next check-in (within the
        poll interval). Type the highlighted word to confirm — there&apos;s no undo. When in doubt,
        start with the lightest fix (restart) and escalate only if it doesn&apos;t help.
      </p>
      <div className="flex flex-col gap-2">
          {HOST_ACTION_COMMANDS.map((a) => {
            const typed = confirmWord[a.id] ?? "";
            const armed = typed.toUpperCase() === a.confirmWord;
            const tone =
              a.danger === "red"
                ? "border-destructive/40"
                : "border-amber-500/40";
            return (
              <form
                action={action}
                key={a.id}
                className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 ${tone}`}
              >
                <input type="hidden" name="sensorId" value={sensorId} />
                <input type="hidden" name="basePath" value={basePath} />
                <input type="hidden" name="command" value={a.id} />
                <div className="flex min-w-[14rem] flex-1 flex-col gap-0.5">
                  <span className="text-sm font-medium">{a.label}</span>
                  <span className="text-xs text-muted-foreground">{a.when}</span>
                </div>
                <Input
                  name="confirm"
                  value={typed}
                  onChange={(e) =>
                    setConfirmWord((m) => ({ ...m, [a.id]: e.target.value }))
                  }
                  placeholder={`type ${a.confirmWord}`}
                  className="h-9 w-36 font-mono text-xs"
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button
                  type="submit"
                  size="sm"
                  variant={a.danger === "red" ? "destructive" : "outline"}
                  disabled={pending || !armed}
                >
                  {a.label}
                </Button>
              </form>
            );
          })}
        </div>
      <Notice state={state} />
      <p className="text-[11px] text-muted-foreground">
        ⚠ Privileged actions — every run is audited and shows on the security feed. The outcome
        appears on the next check-in (uptime, version, or a recreated container).
      </p>
    </div>
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
  const [cmdState, cmdAction, queuing] = useActionState<SensorActionState, FormData>(
    queueCommandAction,
    {},
  );

  const [openCmd, setOpenCmd] = useState<number | null>(null);
  const [showAllCmds, setShowAllCmds] = useState(false);

  // Per-sensor desired-config editing was consolidated into the global Network
  // settings page (/settings/network); we link there now instead of duplicating
  // the form here. districtSlug is the first path segment of basePath
  // (/<district>/<school>/sensor/<id>).
  const districtSlug = basePath.split("/").filter(Boolean)[0] ?? "";
  // Show the 5 most recent commands; collapse the rest behind a toggle.
  const sortedCmds = [...mgmt.commands].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const shownCmds = showAllCmds ? sortedCmds : sortedCmds.slice(0, 5);

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

      {/* Configuration — consolidated into the global Network settings page */}
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
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            This sensor&apos;s capabilities — SNMP, spine crawl, SFTP upload, iperf, speed tests,
            latency — plus the district&apos;s shared settings (SNMP community, iperf server, DHCP
            policy) now live on the single <strong>School &amp; district settings</strong> page, so
            everything is in one place instead of scattered per district/school/sensor.
          </p>
          <div>
            <Button asChild size="sm">
              <Link href={`/settings/network?district=${districtSlug}`}>
                <Settings2 className="size-4" /> Open School &amp; district settings
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Remote console and commands — one card for everything you'd reach for
          on a box. Diagnostics + in-container operations (force scan / upload /
          backup / collect-logs) run LIVE over the approved, recorded session and
          stream into the terminal. Host actions + code update take the queued
          near-live path (host wrapper, next check-in) and land in the history. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Terminal className="size-4 text-primary" />
            Remote console and commands
            <span className="text-xs font-normal text-muted-foreground">live session + maintenance</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {/* Live session over the zero-secret tunnel broker (superadmin, approved,
              time-boxed, recorded, kill-switch). Diagnostics + in-container ops +
              controls all stream here. */}
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-muted-foreground">Live session</p>
            <RemoteConsoleLive sensorId={sensorId} basePath={basePath} />
          </div>

          <div className="border-t" />

          {/* Host maintenance & recovery — queued near-live (can't stream live). */}
          <HostMaintenanceSection sensorId={sensorId} basePath={basePath} />

          <div className="border-t" />

          {/* Code update (near-live, queued) + the queued-command result history. */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <ArrowUpCircle className="size-4 text-primary" />
              <span className="text-sm font-medium">Update &amp; history</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-input p-3">
              <form action={cmdAction}>
                <input type="hidden" name="sensorId" value={sensorId} />
                <input type="hidden" name="basePath" value={basePath} />
                <input type="hidden" name="command" value="update" />
                <Button
                  type="submit"
                  size="sm"
                  className="bg-blue-600 text-white hover:bg-blue-700"
                  disabled={queuing}
                >
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
              Host actions and updates land here when the box reports their result on the next
              check-in. Live diagnostics/operations stream into the session terminal above.
            </p>

            {sortedCmds.length > 0 && (
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
                    {shownCmds.map((c) => {
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
            {sortedCmds.length > 5 && (
              <button
                type="button"
                onClick={() => setShowAllCmds((v) => !v)}
                className="self-start text-xs text-primary hover:underline"
              >
                {showAllCmds ? "Show fewer" : `Show ${sortedCmds.length - 5} older`}
              </button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
