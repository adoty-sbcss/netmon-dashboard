"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyRound, Pencil, Plus, Radio, Upload, Waypoints } from "lucide-react";

import type { InventoryRow } from "@/lib/inventory/queries";
import type { ReachabilitySummary } from "@/db/queries";
import {
  syncRegistryToSensorAction,
  type InventoryActionState,
} from "@/lib/inventory/actions";
import { ReachabilityTable } from "../switches/reachability-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface NeighborLink {
  id: number;
  localPort: string | null;
  systemName: string | null;
  chassisId: string | null;
  systemDescription: string | null;
  portId: string | null;
  portDescription: string | null;
  mgmtIp: string | null;
  vlanId: number | null;
  protocol: string | null;
}

type Tab = "devices" | "links" | "reach";
type Category = "all" | "infra" | "endpoints";
type SourceFilter = "all" | "discovered" | "manual";
type SnmpFilter = "all" | "ok" | "gap";

const INFRA = new Set(["switch", "router", "ap", "firewall"]);
const selectCls =
  "h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/50";

function SourceBadge({ source }: { source: InventoryRow["source"] }) {
  const m = {
    discovered: { label: "Discovered", cls: "text-muted-foreground" },
    manual: { label: "Manual", cls: "border-primary/40 text-primary" },
    both: { label: "Registered", cls: "border-[var(--success)]/40 text-[var(--success)]" },
  }[source];
  return <Badge variant="outline" className={"text-[10px] uppercase " + m.cls}>{m.label}</Badge>;
}

function SnmpBadge({ status }: { status: InventoryRow["snmp"] }) {
  if (status === "responding")
    return <Badge variant="outline" className="border-[var(--success)]/40 text-[var(--success)]"><Radio className="mr-1 size-3" />SNMP</Badge>;
  if (status === "gap")
    return <Badge variant="outline" className="border-[var(--warning)]/40 text-[var(--warning)]">No SNMP</Badge>;
  return <span className="text-xs text-muted-foreground">—</span>;
}

function hrefFor(r: InventoryRow, basePath: string): string | null {
  if (r.switchId) return `${basePath}/switch/${r.switchId}`;
  if (r.hostId) return `${basePath}/host/${r.hostId}`;
  if (r.registryId) return `${basePath}/registry/${r.registryId}/edit`;
  return null;
}

export function DevicesHub({
  rows,
  neighbors,
  reachability,
  schoolId,
  basePath,
  isAdmin,
  initialTab = "devices",
  initialCategory = "all",
  initialSource = "all",
}: {
  rows: InventoryRow[];
  neighbors: NeighborLink[];
  reachability: ReachabilitySummary;
  schoolId: number;
  basePath: string;
  isAdmin: boolean;
  initialTab?: Tab;
  initialCategory?: Category;
  initialSource?: SourceFilter;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [syncState, syncAction, syncing] = useActionState<InventoryActionState, FormData>(
    syncRegistryToSensorAction,
    {},
  );
  const [category, setCategory] = useState<Category>(initialCategory);
  const [source, setSource] = useState<SourceFilter>(initialSource);
  const [snmp, setSnmp] = useState<SnmpFilter>("all");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      const isInfra = r.isSwitch || INFRA.has(r.deviceType ?? "");
      if (category === "infra" && !isInfra) return false;
      if (category === "endpoints" && isInfra) return false;
      if (source === "discovered" && r.source === "manual") return false;
      if (source === "manual" && r.source === "discovered") return false;
      if (snmp === "ok" && r.snmp !== "responding") return false;
      if (snmp === "gap" && r.snmp !== "gap") return false;
      if (term) {
        const hay = `${r.name} ${r.ip ?? ""} ${r.mac ?? ""} ${r.vendor ?? ""} ${r.model ?? ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [rows, category, source, snmp, q]);

  return (
    <div className="flex flex-col gap-4">
      {/* Tabs + actions */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border text-sm">
          {([
            ["devices", "Devices"],
            ["links", "Links (LLDP)"],
            ["reach", "Reachability"],
          ] as [Tab, string][]).map(([t, label]) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={"px-3 py-1.5 " + (tab === t ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
            >
              {label}
            </button>
          ))}
        </div>
        {isAdmin && tab === "devices" && (
          <div className="ml-auto flex flex-wrap gap-2">
            <form action={syncAction}>
              <input type="hidden" name="schoolId" value={schoolId} />
              <input type="hidden" name="basePath" value={basePath} />
              <Button type="submit" variant="outline" size="sm" disabled={syncing} title="Push registry SNMP community strings to this school's sensors">
                <KeyRound className="size-4" /> {syncing ? "Syncing…" : "Sync SNMP to sensor"}
              </Button>
            </form>
            <Button asChild variant="outline" size="sm">
              <Link href={`${basePath}/registry/import`}><Upload className="size-4" /> Import CSV</Link>
            </Button>
            <Button asChild size="sm">
              <Link href={`${basePath}/registry/new`}><Plus className="size-4" /> Add device</Link>
            </Button>
          </div>
        )}
      </div>

      {(syncState.message || syncState.error) && (
        <p className={syncState.error ? "text-sm text-destructive" : "text-sm text-emerald-600 dark:text-emerald-400"}>
          {syncState.error || syncState.message}
        </p>
      )}

      {tab === "devices" && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-lg border text-sm">
              {(["all", "infra", "endpoints"] as Category[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={"px-2.5 py-1 capitalize " + (category === c ? "bg-accent font-medium" : "hover:bg-accent/50")}
                >
                  {c === "infra" ? "Infrastructure" : c === "endpoints" ? "Endpoints" : "All"}
                </button>
              ))}
            </div>
            <select className={selectCls} value={source} onChange={(e) => setSource(e.target.value as SourceFilter)}>
              <option value="all">Any source</option>
              <option value="discovered">Discovered</option>
              <option value="manual">Manual</option>
            </select>
            <select className={selectCls} value={snmp} onChange={(e) => setSnmp(e.target.value as SnmpFilter)}>
              <option value="all">Any SNMP</option>
              <option value="ok">Answering SNMP</option>
              <option value="gap">SNMP gap</option>
            </select>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name / IP / MAC / vendor" className="h-8 max-w-xs" />
            <span className="ml-auto text-xs text-muted-foreground">{filtered.length} of {rows.length}</span>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="hidden lg:table-cell">Vendor / model</TableHead>
                  <TableHead className="hidden md:table-cell">IP / MAC</TableHead>
                  <TableHead className="hidden xl:table-cell">Location</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>SNMP</TableHead>
                  <TableHead>Source</TableHead>
                  {isAdmin && <TableHead className="w-8" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => {
                  const href = hrefFor(r, basePath);
                  return (
                    <TableRow
                      key={r.key}
                      className={(r.snmp === "gap" ? "bg-[var(--warning)]/5 " : "") + (href ? "cursor-pointer hover:bg-accent/40" : "")}
                      onClick={() => href && router.push(href)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2 font-medium">
                          <span className={r.online ? "size-2 shrink-0 rounded-full bg-[var(--success)]" : "size-2 shrink-0 rounded-full bg-muted-foreground/40"} />
                          {r.name}
                        </div>
                      </TableCell>
                      <TableCell className="capitalize">{r.deviceType ?? "—"}</TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{[r.vendor, r.model].filter(Boolean).join(" ") || "—"}</TableCell>
                      <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                        {r.ip ?? "—"}{r.mac ? <div>{r.mac}</div> : null}
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">{[r.building, r.room].filter(Boolean).join(" / ") || "—"}</TableCell>
                      <TableCell><span className={r.online ? "text-[var(--success)]" : "text-muted-foreground"}>{r.online ? "Online" : "Offline"}</span></TableCell>
                      <TableCell><SnmpBadge status={r.snmp} /></TableCell>
                      <TableCell><SourceBadge source={r.source} /></TableCell>
                      {isAdmin && (
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {r.registryId ? (
                            <Link href={`${basePath}/registry/${r.registryId}/edit`} className="text-primary hover:underline"><Pencil className="size-3.5" /></Link>
                          ) : null}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {tab === "links" && (
        <div className="overflow-x-auto rounded-lg border">
          {neighbors.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Waypoints className="size-8 text-muted-foreground" />
              <p className="font-medium">No LLDP/CDP neighbors</p>
              <p className="max-w-sm text-sm text-muted-foreground">Adjacencies appear as sensors learn them from LLDP/CDP frames.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Local port</TableHead>
                  <TableHead>Neighbor</TableHead>
                  <TableHead>Remote port</TableHead>
                  <TableHead className="hidden md:table-cell">Mgmt IP</TableHead>
                  <TableHead className="hidden sm:table-cell">VLAN</TableHead>
                  <TableHead className="hidden lg:table-cell">Proto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {neighbors.map((n) => (
                  <TableRow key={n.id}>
                    <TableCell className="font-mono text-xs">{n.localPort ?? "—"}</TableCell>
                    <TableCell>
                      <div className="font-medium">{n.systemName || n.chassisId || "—"}</div>
                      {n.systemDescription && <div className="max-w-xs truncate text-xs text-muted-foreground" title={n.systemDescription}>{n.systemDescription}</div>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{n.portId ?? n.portDescription ?? "—"}</TableCell>
                    <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">{n.mgmtIp ?? "—"}</TableCell>
                    <TableCell className="hidden tabular-nums sm:table-cell">{n.vlanId ?? "—"}</TableCell>
                    <TableCell className="hidden lg:table-cell">{n.protocol ? <Badge variant="outline" className="text-[10px] uppercase">{n.protocol}</Badge> : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {tab === "reach" && (
        <div className="rounded-lg border p-3 sm:p-4">
          {reachability.total > 0 ? (
            <ReachabilityTable summary={reachability} />
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No reachability probes yet. They appear after the sensor scans the
              infrastructure candidate set (gateway, LLDP mgmt IPs, network-vendor gear).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
