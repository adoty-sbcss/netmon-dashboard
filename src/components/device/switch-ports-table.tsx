"use client";

import { useState } from "react";
import Link from "next/link";
import { Cable } from "lucide-react";

import type { SwitchPort, ConnectedDevice } from "@/db/queries";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/section-header";
import { DeviceTypeBadge } from "@/components/device-type-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** ifHighSpeed (Mbps) → human label. */
function speedLabel(mbps?: number | null): string {
  if (mbps == null || mbps <= 0) return "—";
  if (mbps >= 1000) {
    const g = mbps / 1000;
    return `${Number.isInteger(g) ? g : g.toFixed(1)} Gbps`;
  }
  return `${mbps} Mbps`;
}

/** PoE → a compact label + tone, or null when no PoE info on this port. */
function poeLabel(
  poe: SwitchPort["poe"],
): { text: string; tone: "on" | "off" | "fault" } | null {
  if (!poe) return null;
  const status = poe.status ?? (poe.admin === false ? "disabled" : null);
  if (!status) return null;
  if (status === "deliveringPower") {
    const w = poe.power_w != null ? ` · ${poe.power_w} W` : "";
    const cls = poe.class ? ` · ${poe.class}` : "";
    return { text: `On${w}${cls}`, tone: "on" };
  }
  if (status === "fault" || status === "otherFault") return { text: "Fault", tone: "fault" };
  if (status === "searching") return { text: "Searching", tone: "off" };
  return { text: "Off", tone: "off" };
}

/** The device(s) the FDB learned on a port — matched to inventory, click-through. */
function ConnectedCell({
  devices,
  basePath,
}: {
  devices: ConnectedDevice[];
  basePath: string;
}) {
  if (devices.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col gap-1">
      {devices.map((d) => {
        const label = d.hostname || d.ip || d.mac;
        const href =
          d.entityId && d.entityKind ? `${basePath}/${d.entityKind}/${d.entityId}` : null;
        return (
          <div key={d.mac} className="flex flex-wrap items-center gap-1.5">
            <DeviceTypeBadge type={d.deviceType} />
            {href ? (
              <Link href={href} className="text-primary hover:underline">
                {label}
              </Link>
            ) : (
              <span>{label}</span>
            )}
            {d.ip && d.hostname && (
              <span className="font-mono text-xs text-muted-foreground">{d.ip}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

type Row = { key: string; ifName: string; alias: string | null; port: SwitchPort | null; devices: ConnectedDevice[] };

/**
 * Consolidated per-port view for a crawled switch/router: each port's health
 * (speed/status/duplex/errors/STP/PoE) alongside the device(s) the bridge FDB
 * learned on it, matched to the inventory (IP, reverse-DNS, type, click-through).
 * A "hide down ports" toggle declutters unused ports, and STP "blocking" is only
 * shown on UP ports (a down/empty port is "blocking" by default — not a fault).
 * Renders nothing when there are no ports AND no connected devices. Used on the
 * switch page and on host pages where the host is itself crawled infra.
 */
export function SwitchPortsTable({
  ports,
  connectedDevices,
  basePath,
}: {
  ports: SwitchPort[];
  connectedDevices: ConnectedDevice[];
  basePath: string;
}) {
  const [hideDown, setHideDown] = useState(false);
  if (ports.length === 0 && connectedDevices.length === 0) return null;

  // Group connected devices onto their port (by ifName).
  const byPort = new Map<string, ConnectedDevice[]>();
  for (const d of connectedDevices) {
    const k = d.ifName ?? "";
    const arr = byPort.get(k);
    if (arr) arr.push(d);
    else byPort.set(k, [d]);
  }
  const portNames = new Set(ports.map((p) => p.name ?? ""));
  const anyPoe = ports.some((p) => p.poe);
  const downCount = ports.filter((p) => p.oper_status !== "up").length;

  const rows: Row[] = [];
  for (const p of ports) {
    const devices = byPort.get(p.name ?? "") ?? [];
    // Hide-down keeps any port that's up OR still has a learned device.
    if (hideDown && p.oper_status !== "up" && devices.length === 0) continue;
    rows.push({
      key: `p-${p.ifIndex}`,
      ifName: p.name ?? `if${p.ifIndex}`,
      alias: p.alias ?? null,
      port: p,
      devices,
    });
  }
  // Connected devices whose port isn't in the interface list (e.g. the switch
  // had FDB but no interface-health snapshot) — surface them so none are lost.
  const orphanByPort = new Map<string, ConnectedDevice[]>();
  for (const d of connectedDevices) {
    if (d.ifName && portNames.has(d.ifName)) continue;
    const k = d.ifName ?? "—";
    const arr = orphanByPort.get(k);
    if (arr) arr.push(d);
    else orphanByPort.set(k, [d]);
  }
  for (const [ifName, devices] of orphanByPort) {
    rows.push({ key: `o-${ifName}`, ifName, alias: null, port: null, devices });
  }

  return (
    <Card>
      <SectionHeader
        icon={Cable}
        title="Ports"
        meta={
          <>
            {num(ports.length)} interfaces
            {connectedDevices.length > 0 && ` · ${connectedDevices.length} connected`}
          </>
        }
        action={
          downCount > 0 ? (
            <label className="flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={hideDown}
                onChange={(e) => setHideDown(e.target.checked)}
                className="size-4 rounded border-input accent-[var(--primary)]"
              />
              Hide down ports ({downCount})
            </label>
          ) : undefined
        }
      />
      <CardContent className="px-0 sm:px-6">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Port</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Speed</TableHead>
                {anyPoe && <TableHead className="hidden md:table-cell">PoE</TableHead>}
                <TableHead>Connected device</TableHead>
                <TableHead className="hidden lg:table-cell">Duplex</TableHead>
                <TableHead className="hidden lg:table-cell">Errors</TableHead>
                <TableHead className="hidden xl:table-cell">STP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const p = r.port;
                const poe = poeLabel(p?.poe ?? null);
                const errs = (p?.in_errors ?? 0) + (p?.out_errors ?? 0);
                const up = p?.oper_status === "up";
                const adminDown = p?.admin_status === "down";
                // STP "blocking" only matters on an UP port (a redundant link held
                // down). A down/empty port is "blocking" by default → not a fault.
                const stp = up ? p?.stp_state : null;
                return (
                  <TableRow key={r.key}>
                    <TableCell className="align-top font-mono text-xs">
                      <div className="font-medium">{r.ifName}</div>
                      {r.alias && (
                        <div className="font-sans text-muted-foreground">{r.alias}</div>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      {!p ? (
                        <span className="text-muted-foreground">—</span>
                      ) : adminDown ? (
                        <Badge variant="outline" className="text-[var(--warning)]">
                          disabled
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className={cn(
                            up ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
                          )}
                        >
                          {p.oper_status ?? "—"}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden align-top tabular-nums sm:table-cell">
                      {speedLabel(p?.speed_mbps)}
                    </TableCell>
                    {anyPoe && (
                      <TableCell className="hidden align-top md:table-cell">
                        {poe ? (
                          <span
                            className={cn(
                              "text-xs",
                              poe.tone === "on" && "text-emerald-600 dark:text-emerald-400",
                              poe.tone === "fault" && "text-destructive",
                              poe.tone === "off" && "text-muted-foreground",
                            )}
                          >
                            {poe.text}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    )}
                    <TableCell className="align-top">
                      <ConnectedCell devices={r.devices} basePath={basePath} />
                    </TableCell>
                    <TableCell className="hidden align-top capitalize lg:table-cell">
                      {p?.duplex ?? "—"}
                    </TableCell>
                    <TableCell className="hidden align-top tabular-nums lg:table-cell">
                      {errs > 0 ? (
                        <span className="text-destructive">{num(errs)}</span>
                      ) : (
                        <span className="text-muted-foreground">{p ? "0" : "—"}</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden align-top xl:table-cell">
                      {stp ? (
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] uppercase",
                            stp === "blocking" && "text-[var(--warning)]",
                          )}
                        >
                          {stp}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
