import { Cable } from "lucide-react";

import type { SwitchPort } from "@/db/queries";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

/**
 * Per-port table for a crawled switch/router (CORE-2/INV `interfaces`). Renders
 * nothing when there are no ports (un-crawled gear / endpoints). PoE/alias/duplex
 * columns fill in once the collector reaches the box and re-crawls; speed/status/
 * errors/STP are available immediately. Shared by the switch + host pages.
 */
export function SwitchPortsTable({ ports }: { ports: SwitchPort[] }) {
  if (ports.length === 0) return null;
  const anyPoe = ports.some((p) => p.poe);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Cable className="size-4 text-primary" />
          Ports
          <span className="ml-1 text-sm font-normal text-muted-foreground">
            {num(ports.length)} interfaces
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 sm:px-6">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Port</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Speed</TableHead>
                <TableHead className="hidden md:table-cell">Duplex</TableHead>
                {anyPoe && <TableHead>PoE</TableHead>}
                <TableHead className="hidden lg:table-cell">Errors</TableHead>
                <TableHead className="hidden lg:table-cell">STP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ports.map((p) => {
                const poe = poeLabel(p.poe);
                const errs = (p.in_errors ?? 0) + (p.out_errors ?? 0);
                const up = p.oper_status === "up";
                const adminDown = p.admin_status === "down";
                return (
                  <TableRow key={p.ifIndex}>
                    <TableCell className="align-top font-mono text-xs">
                      <div className="font-medium">{p.name ?? `if${p.ifIndex}`}</div>
                      {p.alias && (
                        <div className="font-sans text-muted-foreground">{p.alias}</div>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      {adminDown ? (
                        <Badge variant="outline" className="text-[var(--warning)]">
                          disabled
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className={cn(
                            up && "text-emerald-600 dark:text-emerald-400",
                            !up && "text-muted-foreground",
                          )}
                        >
                          {p.oper_status ?? "—"}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden align-top tabular-nums sm:table-cell">
                      {speedLabel(p.speed_mbps)}
                    </TableCell>
                    <TableCell className="hidden align-top capitalize md:table-cell">
                      {p.duplex ?? "—"}
                    </TableCell>
                    {anyPoe && (
                      <TableCell className="align-top">
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
                    <TableCell className="hidden align-top tabular-nums lg:table-cell">
                      {errs > 0 ? (
                        <span className="text-destructive">{num(errs)}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden align-top lg:table-cell">
                      {p.stp_state ? (
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] uppercase",
                            p.stp_state === "blocking" && "text-[var(--warning)]",
                          )}
                        >
                          {p.stp_state}
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
