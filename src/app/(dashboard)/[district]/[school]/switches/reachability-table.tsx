"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { CheckCircle2, MinusCircle, Radio, Route, XCircle } from "lucide-react";

import type { ReachabilitySummary } from "@/db/queries";
import { Badge } from "@/components/ui/badge";

const SOURCE_LABEL: Record<string, string> = {
  gateway: "gateway",
  lldp: "LLDP mgmt",
  oui: "vendor OUI",
};

function rtt(v: number | null): string {
  return typeof v === "number" ? `${v.toFixed(1)} ms` : "—";
}

export function ReachabilityTable({
  summary,
  basePath,
}: {
  summary: ReachabilitySummary;
  basePath: string;
}) {
  const [open, setOpen] = useState<number | null>(null);

  if (summary.total === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {/* Summary chips */}
      <div className="flex flex-wrap gap-2 text-sm">
        <Stat label="Probed" value={summary.total} tone="muted" />
        <Stat label="Answered SNMP" value={summary.snmpOk} tone="ok" />
        <Stat label="Reachable, no SNMP" value={summary.reachableNoSnmp} tone="warn" />
        <Stat label="Unreachable" value={summary.unreachable} tone="bad" />
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="px-3 py-2 text-left font-medium">Device</th>
              <th className="px-3 py-2 text-left font-medium">Source</th>
              <th className="px-3 py-2 text-left font-medium">Ping</th>
              <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">RTT</th>
              <th className="px-3 py-2 text-left font-medium">SNMP</th>
              <th className="px-3 py-2 text-right font-medium">Hops</th>
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((r) => {
              const hasPath = r.traceroutePath.length > 0;
              const isOpen = open === r.id;
              return (
                <Fragment key={r.id}>
                  <tr
                    className={
                      "border-b last:border-0 " +
                      (hasPath ? "cursor-pointer hover:bg-accent/40" : "")
                    }
                    onClick={() => hasPath && setOpen(isOpen ? null : r.id)}
                  >
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs">
                        {r.entityId && r.entityKind ? (
                          <Link
                            href={`${basePath}/${r.entityKind}/${r.entityId}`}
                            className="text-primary hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {r.ip}
                          </Link>
                        ) : (
                          r.ip
                        )}
                      </div>
                      {(r.hostname || r.vendor) && (
                        <div className="truncate text-xs text-muted-foreground">
                          {r.hostname || r.vendor}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="secondary" className="text-[10px] uppercase">
                        {SOURCE_LABEL[r.source ?? ""] ?? r.source ?? "—"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      {r.pingAlive ? (
                        <span className="inline-flex items-center gap-1 text-[var(--success)]">
                          <CheckCircle2 className="size-3.5" /> up
                        </span>
                      ) : r.tracerouteHops != null ? (
                        <span
                          className="inline-flex items-center gap-1 text-[var(--warning)]"
                          title="No ICMP echo reply, but traceroute reached it — ICMP likely filtered"
                        >
                          <MinusCircle className="size-3.5" /> filtered
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-destructive">
                          <XCircle className="size-3.5" /> down
                        </span>
                      )}
                    </td>
                    <td className="hidden px-3 py-2 text-right tabular-nums text-muted-foreground sm:table-cell">
                      {rtt(r.pingRttMs)}
                    </td>
                    <td className="px-3 py-2">
                      {r.snmpResponded ? (
                        <span className="inline-flex items-center gap-1 text-[var(--success)]">
                          <Radio className="size-3.5" /> yes
                          {r.snmpVersion && (
                            <span className="text-[10px] text-muted-foreground">
                              v{r.snmpVersion}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[var(--warning)]">
                          <MinusCircle className="size-3.5" /> no
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {hasPath ? (
                        <span className="inline-flex items-center gap-1">
                          <Route className="size-3.5 text-muted-foreground" />
                          {r.tracerouteHops ?? r.traceroutePath.length}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                  {isOpen && hasPath && (
                    <tr className="bg-muted/30">
                      <td colSpan={6} className="px-3 py-2">
                        <p className="mb-1 text-xs font-medium text-muted-foreground">
                          Traceroute to {r.ip}
                        </p>
                        <ol className="flex flex-col gap-0.5 font-mono text-xs">
                          {r.traceroutePath.map((h, i) => (
                            <li key={i} className="flex gap-3">
                              <span className="w-6 text-right text-muted-foreground">
                                {h.hop}
                              </span>
                              <span className="w-36">{h.ip ?? "* * *"}</span>
                              <span className="text-muted-foreground">
                                {typeof h.rtt_ms === "number" ? `${h.rtt_ms} ms` : ""}
                              </span>
                            </li>
                          ))}
                        </ol>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "warn" | "bad" | "muted";
}) {
  const cls = {
    ok: "border-[var(--success)]/40 text-[var(--success)]",
    warn: "border-[var(--warning)]/40 text-[var(--warning)]",
    bad: "border-destructive/40 text-destructive",
    muted: "text-muted-foreground",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${cls}`}>
      <span className="font-semibold tabular-nums">{value}</span>
      <span className="text-xs">{label}</span>
    </span>
  );
}
