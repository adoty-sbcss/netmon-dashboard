"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Info,
  Layers,
  Search,
  Server,
} from "lucide-react";

import type {
  DhcpAnalysis,
  DhcpClientStatus,
  DhcpClientView,
} from "@/db/queries";
import { relativeTime } from "@/lib/format";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const STATUS_META: Record<
  DhcpClientStatus,
  { label: string; cls: string }
> = {
  ok: { label: "Lease OK", cls: "border-[var(--success)] text-[var(--success)]" },
  incomplete: { label: "Incomplete", cls: "border-[var(--warning)] text-[var(--warning)]" },
  "no-response": { label: "No response", cls: "border-[var(--warning)] text-[var(--warning)]" },
  nak: { label: "NAK", cls: "border-destructive text-destructive" },
};

const TYPE_ORDER = ["DISCOVER", "OFFER", "REQUEST", "ACK", "NAK", "INFORM", "RELEASE", "DECLINE"];

function StatusBadge({ status }: { status: DhcpClientStatus }) {
  const m = STATUS_META[status];
  return (
    <Badge variant="outline" className={m.cls}>
      {m.label}
    </Badge>
  );
}

/** The lease story as ordered chips: DISCOVER → OFFER → REQUEST → ACK. */
function FlowChips({ types }: { types: string[] }) {
  const present = new Set(types);
  const ordered = TYPE_ORDER.filter((t) => present.has(t));
  const extras = types.filter((t) => !TYPE_ORDER.includes(t));
  const all = [...ordered, ...extras];
  return (
    <div className="flex flex-wrap items-center gap-1">
      {all.map((t, i) => (
        <span key={t} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="size-3 text-muted-foreground/50" />}
          <Badge
            variant="secondary"
            className={
              "text-[10px] uppercase " +
              (t === "ACK"
                ? "bg-[var(--success)]/15 text-[var(--success)]"
                : t === "NAK"
                  ? "bg-destructive/15 text-destructive"
                  : "")
            }
          >
            {t}
          </Badge>
        </span>
      ))}
    </div>
  );
}

export function DhcpAnalysisView({ analysis }: { analysis: DhcpAnalysis }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<DhcpClientStatus | "all" | "issues">(
    "all",
  );
  const [expanded, setExpanded] = useState<string | null>(null);

  const clients = useMemo(() => {
    const q = query.trim().toLowerCase();
    return analysis.clients.filter((c) => {
      if (statusFilter === "issues" && c.status === "ok") return false;
      if (
        statusFilter !== "all" &&
        statusFilter !== "issues" &&
        c.status !== statusFilter
      )
        return false;
      if (!q) return true;
      return (
        c.clientMac.toLowerCase().includes(q) ||
        (c.lastOfferedIp ?? "").toLowerCase().includes(q) ||
        (c.network ?? "").toLowerCase().includes(q) ||
        (c.server ?? "").toLowerCase().includes(q)
      );
    });
  }, [analysis.clients, query, statusFilter]);

  const ackPct =
    analysis.summary.ackRate != null
      ? `${Math.round(Math.min(1, analysis.summary.ackRate) * 100)}%`
      : "—";
  const issueCount = analysis.issues.filter((i) => i.severity === "warning").length;

  return (
    <div className="flex flex-col gap-6">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <StatCard label="Scopes (subnets)" value={analysis.summary.scopes} icon={Layers} />
        <StatCard label="DHCP servers" value={analysis.summary.servers} icon={Server} />
        <StatCard label="Clients seen" value={analysis.summary.clients} icon={Info} />
        <StatCard
          label="Issues"
          value={issueCount}
          icon={AlertTriangle}
          tone={issueCount > 0 ? "warning" : "success"}
          hint={`ACK/DISCOVER ratio ${ackPct}`}
        />
      </div>

      {/* Issues */}
      {analysis.issues.length > 0 && (
        <Card className="border-[var(--warning)]/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-[var(--warning)]" />
              What to look at
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {analysis.issues.map((iss, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <Badge
                  variant="outline"
                  className={
                    iss.severity === "warning"
                      ? "mt-0.5 border-[var(--warning)] text-[var(--warning)]"
                      : "mt-0.5 text-muted-foreground"
                  }
                >
                  {iss.severity}
                </Badge>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{iss.title}</p>
                  <p className="text-sm text-muted-foreground">{iss.detail}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Scopes */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="size-4 text-primary" />
            Scopes
            <span className="text-sm font-normal text-muted-foreground">
              derived from captured OFFER/ACK options
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          {analysis.scopes.length === 0 ? (
            <p className="px-6 py-6 text-sm text-muted-foreground">
              No scopes derived yet — needs at least one OFFER/ACK with a subnet mask.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subnet</TableHead>
                    <TableHead className="hidden sm:table-cell">Gateway</TableHead>
                    <TableHead>Server(s)</TableHead>
                    <TableHead className="text-right">Clients</TableHead>
                    <TableHead className="hidden md:table-cell text-right">Leases seen</TableHead>
                    <TableHead className="hidden lg:table-cell text-right">ACK / NAK</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analysis.scopes.map((s) => (
                    <TableRow key={s.network}>
                      <TableCell className="font-mono text-sm">{s.network}</TableCell>
                      <TableCell className="hidden font-mono text-xs sm:table-cell">
                        {s.router ?? "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {s.servers.length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            s.servers.map((ip) => (
                              <Badge
                                key={ip}
                                variant="outline"
                                className={
                                  "font-mono text-xs " +
                                  (s.servers.length > 1
                                    ? "border-[var(--warning)] text-[var(--warning)]"
                                    : "")
                                }
                              >
                                {ip}
                              </Badge>
                            ))
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{s.clients}</TableCell>
                      <TableCell className="hidden md:table-cell text-right tabular-nums">
                        {s.offeredIps}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-right tabular-nums">
                        {s.acks}
                        {s.naks > 0 && (
                          <span className="text-destructive"> / {s.naks}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Clients */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clients</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 px-0 sm:px-6">
          <div className="flex flex-wrap items-center gap-2 px-6 sm:px-0">
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search MAC, IP, subnet, server…"
                className="pl-8"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as DhcpClientStatus | "all" | "issues")
              }
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            >
              <option value="all">All clients</option>
              <option value="issues">Only issues</option>
              <option value="ok">Lease OK</option>
              <option value="incomplete">Incomplete</option>
              <option value="no-response">No response</option>
              <option value="nak">NAK</option>
            </select>
            <span className="ml-auto text-sm text-muted-foreground tabular-nums">
              {clients.length} of {analysis.clients.length}
            </span>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Client MAC</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Flow</TableHead>
                  <TableHead className="hidden sm:table-cell">Address</TableHead>
                  <TableHead className="hidden lg:table-cell">Subnet</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      No clients match.
                    </TableCell>
                  </TableRow>
                ) : (
                  clients.map((c) => (
                    <ClientRows
                      key={c.clientMac}
                      client={c}
                      open={expanded === c.clientMac}
                      onToggle={() =>
                        setExpanded((cur) => (cur === c.clientMac ? null : c.clientMac))
                      }
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Info className="size-3.5" />
        DHCP is observed passively on the wire, so scopes and leases are inferred
        from the OFFER/ACK packets a sensor happened to capture — counts are a
        lower bound, not the server&apos;s authoritative lease database.
        {analysis.truncated && " Showing the most recent 3,000 packets."}
      </p>
    </div>
  );
}

function ClientRows({
  client,
  open,
  onToggle,
}: {
  client: DhcpClientView;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <TableRow className="cursor-pointer hover:bg-accent/40" onClick={onToggle}>
        <TableCell className="text-muted-foreground">
          <ChevronRight className={"size-4 transition-transform " + (open ? "rotate-90" : "")} />
        </TableCell>
        <TableCell className="font-mono text-xs">{client.clientMac}</TableCell>
        <TableCell>
          <StatusBadge status={client.status} />
        </TableCell>
        <TableCell className="hidden md:table-cell">
          <FlowChips types={client.types} />
        </TableCell>
        <TableCell className="hidden font-mono text-xs tabular-nums sm:table-cell">
          {client.lastOfferedIp ?? "—"}
        </TableCell>
        <TableCell className="hidden font-mono text-xs lg:table-cell">
          {client.network ?? "—"}
        </TableCell>
      </TableRow>
      {open && (
        <TableRow className="bg-muted/30">
          <TableCell />
          <TableCell colSpan={5} className="py-3">
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-muted-foreground">
                {client.count} packet{client.count === 1 ? "" : "s"} observed
                {client.server ? ` · server ${client.server}` : ""}
              </p>
              <div className="overflow-x-auto">
                <table className="text-xs">
                  <tbody>
                    {client.messages.map((m, i) => (
                      <tr key={i} className="align-top">
                        <td className="py-0.5 pr-3">
                          <Badge variant="secondary" className="text-[10px] uppercase">
                            {m.type}
                          </Badge>
                        </td>
                        <td className="py-0.5 pr-3 font-mono">{m.offeredIp ?? "—"}</td>
                        <td className="py-0.5 pr-3 font-mono text-muted-foreground">
                          {m.serverIp ?? "—"}
                        </td>
                        <td className="py-0.5 text-muted-foreground">
                          {m.seenAt ? relativeTime(m.seenAt) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
