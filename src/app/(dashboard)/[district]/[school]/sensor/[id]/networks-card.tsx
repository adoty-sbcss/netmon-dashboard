import { Waypoints, CircleCheck, AlertTriangle, Clock, Globe } from "lucide-react";

import type { SensorNetwork } from "@/db/queries";
import { num, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
// Freshness is computed in getSensorNetworks (server query), not here — calling
// Date.now() during render is impure and unstable across re-renders.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type NetState = "collecting" | "stale" | "no-data" | "pending";

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

function chip(state: NetState, isPrimary: boolean) {
  if (isPrimary && state === "collecting")
    return { tone: "text-primary bg-primary/10", Icon: Globe, text: "Primary uplink" };
  switch (state) {
    case "collecting":
      return {
        tone: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
        Icon: CircleCheck,
        text: "Collecting",
      };
    case "stale":
      return { tone: "text-[var(--warning)] bg-[var(--warning)]/10", Icon: AlertTriangle, text: "Stale" };
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
 * scan_runs (one row per interface) and diffed against the configured trunk
 * VLANs so a VLAN that's configured but silent (no DHCP lease, or the box
 * hasn't applied the config yet) surfaces instead of just being absent.
 * Display-only (Phase 1); the precise "why it's silent" sharpens once the box
 * reports its live interface list (Phase 2).
 */
export function NetworksCard({
  networks,
  configuredVlans,
  configApplied,
  trunkParent,
}: {
  networks: SensorNetwork[];
  configuredVlans: number[];
  configApplied: boolean;
  trunkParent: string | null;
}) {
  const scannedVlans = new Set(networks.map((n) => n.vlanId).filter((v): v is number => v != null));

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

  // Configured VLANs that produced no scan at all — surface them as silent.
  for (const vid of configuredVlans) {
    if (scannedVlans.has(vid)) continue;
    rows.push({
      interface: trunkParent ? `${trunkParent}.${vid}` : `vlan${vid}`,
      vlanId: vid,
      label: `VLAN ${vid}`,
      cidr: null,
      lastScanAt: null,
      deviceCount: null,
      isPrimary: false,
      state: configApplied ? "no-data" : "pending",
    });
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Waypoints className="size-4 text-primary" />
            Networks
          </CardTitle>
        </CardHeader>
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
  const attention = rows.filter((r) => r.state !== "collecting").length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Waypoints className="size-4 text-primary" />
          Networks
          <span className="text-sm font-normal text-muted-foreground">
            {num(rows.length)} monitored · {num(collecting)} collecting
            {attention > 0 && (
              <span className="text-[var(--warning)]"> · {num(attention)} need attention</span>
            )}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 sm:px-6">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Network</TableHead>
                <TableHead>Scanned from</TableHead>
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
          scan exists. <span className="text-[var(--warning)]">No data / no lease</span> = the
          sub-interface produced no scan (often no DHCP server on that VLAN).{" "}
          <span className="text-muted-foreground">Not applied</span> = pushed to the box but not
          brought up yet. Configure VLANs in the panel below.
        </p>
      </CardContent>
    </Card>
  );
}
