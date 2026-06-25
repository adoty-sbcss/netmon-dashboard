import { Waypoints, CircleCheck, AlertTriangle, Clock, Globe, Plug } from "lucide-react";

import type { SensorNetwork } from "@/db/queries";
import { num, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
// Freshness is computed in getSensorNetworks (server query), not here — calling
// Date.now() during render is impure and unstable across re-renders.
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/section-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** The box's live interface (reported at check-in — PROV-5 Phase 2). */
export type ReportedInterface = {
  name: string;
  cidr: string | null;
  up: boolean;
  vlan: number | null;
  primary: boolean;
};
export type LastHostAction = {
  action?: string;
  status?: string;
  reason?: string;
  at?: string;
} | null;

// collecting/stale come from scan data. leased/no-lease/not-up are the PRECISE
// states from the box's live interface report; no-data/pending are the fallback
// (older boxes that don't report interfaces yet).
type NetState =
  | "collecting"
  | "stale"
  | "leased"
  | "no-lease"
  | "not-up"
  | "no-data"
  | "pending";

type NetRow = {
  interface: string;
  vlanId: number | null;
  label: string;
  cidr: string | null;
  lastScanAt: Date | null;
  deviceCount: number | null;
  isPrimary: boolean;
  state: NetState;
};

const HEALTHY: NetState[] = ["collecting", "leased"];

function chip(state: NetState, isPrimary: boolean) {
  if (isPrimary && (state === "collecting" || state === "leased"))
    return { tone: "text-primary bg-primary/10", Icon: Globe, text: "Primary uplink" };
  switch (state) {
    case "collecting":
      return {
        tone: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
        Icon: CircleCheck,
        text: "Collecting",
      };
    case "leased":
      return { tone: "text-primary bg-primary/10", Icon: Plug, text: "Up · scan pending" };
    case "stale":
      return { tone: "text-[var(--warning)] bg-[var(--warning)]/10", Icon: AlertTriangle, text: "Stale" };
    case "no-lease":
      return {
        tone: "text-[var(--warning)] bg-[var(--warning)]/10",
        Icon: AlertTriangle,
        text: "Up, no DHCP lease",
      };
    case "not-up":
      return { tone: "text-muted-foreground bg-muted", Icon: Clock, text: "Not up on the box" };
    case "no-data":
      return {
        tone: "text-[var(--warning)] bg-[var(--warning)]/10",
        Icon: AlertTriangle,
        text: "No data yet",
      };
    default:
      return {
        tone: "text-muted-foreground bg-muted",
        Icon: Clock,
        text: "Configured, not applied",
      };
  }
}

/**
 * Per-network / per-VLAN status for a sensor — which networks are actually
 * collecting data, the IP each got, last scan and device count. Built from
 * scan_runs and diffed against the configured trunk VLANs. When the box reports
 * its live interface list (PROV-5 Phase 2) a silent VLAN's status is PRECISE —
 * "up, no DHCP lease" vs "not up on the box" — instead of inferred from the
 * config version; and a failed host action (e.g. a VLAN apply that crashed) shows
 * as a banner instead of being invisible.
 */
export function NetworksCard({
  networks,
  configuredVlans,
  configApplied,
  trunkParent,
  reportedInterfaces,
  lastHostAction,
}: {
  networks: SensorNetwork[];
  configuredVlans: number[];
  configApplied: boolean;
  trunkParent: string | null;
  reportedInterfaces?: ReportedInterface[] | null;
  lastHostAction?: LastHostAction;
}) {
  const scannedVlans = new Set(networks.map((n) => n.vlanId).filter((v): v is number => v != null));
  const reported = reportedInterfaces && reportedInterfaces.length > 0 ? reportedInterfaces : null;
  const ifaceByVlan = new Map<number, ReportedInterface>();
  if (reported) for (const i of reported) if (i.vlan != null) ifaceByVlan.set(i.vlan, i);

  const rows: NetRow[] = networks.map((n) => ({
    interface: n.interface,
    vlanId: n.vlanId,
    label: n.vlanId != null ? `VLAN ${n.vlanId}` : "untagged",
    cidr: n.cidr,
    lastScanAt: n.lastScanAt,
    deviceCount: n.deviceCount,
    isPrimary: n.isPrimary,
    state: n.fresh ? "collecting" : "stale",
  }));

  // Configured VLANs that produced no scan — give each a PRECISE state from the
  // box's live interface report when we have it, else fall back to the config-version guess.
  for (const vid of configuredVlans) {
    if (scannedVlans.has(vid)) continue;
    const ri = ifaceByVlan.get(vid);
    let state: NetState;
    let cidr: string | null = null;
    if (reported) {
      if (!ri || !ri.up) state = "not-up"; // sub-interface never came up (apply failed / NM)
      else if (ri.cidr) {
        state = "leased"; // up + has a lease — just hasn't scanned yet
        cidr = ri.cidr;
      } else state = "no-lease"; // up but no DHCP on this VLAN
    } else {
      state = configApplied ? "no-data" : "pending";
    }
    rows.push({
      interface: ri?.name ?? (trunkParent ? `${trunkParent}.${vid}` : `vlan${vid}`),
      vlanId: vid,
      label: `VLAN ${vid}`,
      cidr,
      lastScanAt: null,
      deviceCount: null,
      isPrimary: false,
      state,
    });
  }

  const actionFailed = lastHostAction?.status === "failed";
  const actionAt = lastHostAction?.at ? new Date(lastHostAction.at) : null;

  if (rows.length === 0 && !actionFailed) {
    return (
      <Card>
        <SectionHeader icon={Waypoints} title="Networks" />
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No scans yet. Once the sensor scans its uplink (and any monitored VLANs),
            each network shows up here with the IP it got and whether it&apos;s collecting.
          </p>
        </CardContent>
      </Card>
    );
  }

  rows.sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    if (a.vlanId != null && b.vlanId != null) return a.vlanId - b.vlanId;
    if (a.vlanId == null) return -1;
    if (b.vlanId == null) return 1;
    return a.interface.localeCompare(b.interface);
  });

  const collecting = rows.filter((r) => r.state === "collecting").length;
  const attention = rows.filter((r) => !HEALTHY.includes(r.state)).length;

  return (
    <Card>
      <SectionHeader
        icon={Waypoints}
        title="Networks"
        meta={
          <>
            {num(rows.length)} monitored · {num(collecting)} collecting
            {attention > 0 && (
              <span className="text-[var(--warning)]"> · {num(attention)} need attention</span>
            )}
          </>
        }
      />
      <CardContent className="px-0 sm:px-6">
        {actionFailed && (
          <div className="mx-6 mb-3 rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 text-xs sm:mx-0">
            <span className="font-medium text-destructive">Last host action failed</span>
            {lastHostAction?.action && (
              <span className="font-mono"> · {lastHostAction.action}</span>
            )}
            {actionAt && !Number.isNaN(actionAt.getTime()) && (
              <span className="text-muted-foreground"> · {relativeTime(actionAt)}</span>
            )}
            {lastHostAction?.reason && (
              <div className="mt-0.5 text-muted-foreground">{lastHostAction.reason}</div>
            )}
          </div>
        )}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Network</TableHead>
                <TableHead>IP / lease</TableHead>
                <TableHead className="hidden sm:table-cell">Last scan</TableHead>
                <TableHead className="text-right">Devices</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const c = chip(r.state, r.isPrimary);
                return (
                  <TableRow key={r.interface}>
                    <TableCell className="align-top">
                      <div className="font-mono text-xs font-medium">{r.interface}</div>
                      <div className="text-[11px] text-muted-foreground">{r.label}</div>
                    </TableCell>
                    <TableCell className="align-top font-mono text-xs">
                      {r.cidr ?? (
                        <span className="font-sans text-[var(--warning)]">no lease</span>
                      )}
                    </TableCell>
                    <TableCell
                      className="hidden align-top text-sm text-muted-foreground sm:table-cell"
                      title={r.lastScanAt ? r.lastScanAt.toISOString() : undefined}
                    >
                      {r.lastScanAt ? relativeTime(r.lastScanAt) : "never"}
                    </TableCell>
                    <TableCell className="align-top text-right tabular-nums">
                      {r.deviceCount == null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        num(r.deviceCount)
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs",
                          c.tone,
                        )}
                      >
                        <c.Icon className="size-3.5" />
                        {c.text}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <p className="mt-3 px-6 text-xs text-muted-foreground sm:px-0">
          <span className="text-emerald-600 dark:text-emerald-400">Collecting</span> = a fresh
          scan exists. <span className="text-[var(--warning)]">Up, no DHCP lease</span> = the
          sub-interface came up but no DHCP server answered on that VLAN.{" "}
          <span className="text-muted-foreground">Not up on the box</span> = the VLAN is configured
          but its sub-interface never came up (the apply may have failed). Configure VLANs in the
          panel below.
        </p>
      </CardContent>
    </Card>
  );
}
