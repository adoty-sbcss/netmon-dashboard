"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, KeyRound, Pencil, Plus, Radio, RotateCcw, ShieldCheck, ShieldOff, Tags, Trash2, Upload, Waypoints, X } from "lucide-react";

import type { InventoryRow, ExcludedRow } from "@/lib/inventory/queries";
import type { ReachabilitySummary } from "@/db/queries";
import {
  syncRegistryToSensorAction,
  type InventoryActionState,
} from "@/lib/inventory/actions";
import {
  setSchoolSnmpAction,
  purgeAllDiscoveredAction,
  purgeDeviceAction,
  restoreDeviceAction,
  bulkPurgeDevicesAction,
  bulkReclassifyDevicesAction,
} from "@/lib/inventory/snmp-control";
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

type Tab = "devices" | "links" | "reach" | "excluded";
type Category = "all" | "infra" | "endpoints";
type SourceFilter = "all" | "discovered" | "manual";
type SnmpFilter = "all" | "ok" | "gap";

const INFRA = new Set(["switch", "router", "ap", "firewall"]);
const DEVICE_TYPE_OPTIONS = [
  "switch", "router", "ap", "firewall", "printer", "phone", "camera",
  "computer", "server", "mobile", "storage", "iot", "vm", "unknown",
];
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
  excluded,
  snmpCrawlEnabled,
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
  excluded: ExcludedRow[];
  snmpCrawlEnabled: boolean;
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
  const [snmpState, snmpAction, snmpSaving] = useActionState<InventoryActionState, FormData>(
    setSchoolSnmpAction,
    {},
  );
  const [purgeAllState, purgeAllAction, purging] = useActionState<InventoryActionState, FormData>(
    purgeAllDiscoveredAction,
    {},
  );
  const [bulkPurgeState, bulkPurgeAction, bulkPurging] = useActionState<InventoryActionState, FormData>(
    bulkPurgeDevicesAction,
    {},
  );
  const [reclassState, reclassAction, reclassifying] = useActionState<InventoryActionState, FormData>(
    bulkReclassifyDevicesAction,
    {},
  );
  const [category, setCategory] = useState<Category>(initialCategory);
  const [source, setSource] = useState<SourceFilter>(initialSource);
  const [snmp, setSnmp] = useState<SnmpFilter>("all");
  const [q, setQ] = useState("");
  // Bulk selection (admin map-cleanup): keyed by InventoryRow.key.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reclassType, setReclassType] = useState("unknown");

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

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.key)), [rows, selected]);
  const selectedItems = selectedRows.map((r) => ({ key: r.key, registryId: r.registryId }));
  const selectedHostIds = selectedRows.filter((r) => r.hostId != null).map((r) => r.hostId);
  const allVisibleSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.key));
  function toggle(key: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }
  function toggleAllVisible() {
    setSelected((s) => {
      const n = new Set(s);
      if (allVisibleSelected) filtered.forEach((r) => n.delete(r.key));
      else filtered.forEach((r) => n.add(r.key));
      return n;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Tabs + actions */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border text-sm">
          {([
            ["devices", "Devices"],
            ["links", "Links (LLDP)"],
            ["reach", "Reachability"],
            ...(isAdmin
              ? ([["excluded", excluded.length ? `Excluded (${excluded.length})` : "Excluded"]] as [Tab, string][])
              : []),
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
            <form action={snmpAction}>
              <input type="hidden" name="schoolId" value={schoolId} />
              <input type="hidden" name="basePath" value={basePath} />
              <input type="hidden" name="enabled" value={snmpCrawlEnabled ? "false" : "true"} />
              <Button
                type="submit"
                variant="outline"
                size="sm"
                disabled={snmpSaving}
                title="Master SNMP-crawl switch for every sensor at this school"
                onClick={(e) => {
                  if (snmpCrawlEnabled && !confirm("Disable the SNMP crawl for every sensor at this school?")) e.preventDefault();
                }}
              >
                {snmpCrawlEnabled ? <ShieldOff className="size-4" /> : <ShieldCheck className="size-4" />}
                {snmpSaving ? "Saving…" : snmpCrawlEnabled ? "Disable SNMP crawl" : "Enable SNMP crawl"}
              </Button>
            </form>
            <form action={purgeAllAction}>
              <input type="hidden" name="schoolId" value={schoolId} />
              <input type="hidden" name="basePath" value={basePath} />
              <Button
                type="submit"
                variant="outline"
                size="sm"
                disabled={purging}
                title="Purge every discovered device that isn't in your registry"
                onClick={(e) => {
                  if (!confirm("Purge ALL discovered (non-registered) devices at this school? They'll be hidden and the sensors will stop SNMP-polling them. Restore any from the Excluded tab.")) e.preventDefault();
                }}
              >
                <Ban className="size-4" /> {purging ? "Purging…" : "Purge discovered"}
              </Button>
            </form>
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

      {(() => {
        const err = purgeAllState.error || snmpState.error || syncState.error || bulkPurgeState.error || reclassState.error;
        const msg = purgeAllState.message || snmpState.message || syncState.message || bulkPurgeState.message || reclassState.message;
        if (!err && !msg) return null;
        return (
          <p className={err ? "text-sm text-destructive" : "text-sm text-emerald-600 dark:text-emerald-400"}>
            {err || msg}
          </p>
        );
      })()}

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

          {/* Bulk actions (admin) — appear when devices are selected. Counted off
              selectedRows so it auto-clears as purged rows leave the list. */}
          {isAdmin && selectedRows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2">
              <span className="text-sm font-medium">{selectedRows.length} selected</span>
              <form action={reclassAction} className="flex items-center gap-1.5">
                <input type="hidden" name="schoolId" value={schoolId} />
                <input type="hidden" name="basePath" value={basePath} />
                <input type="hidden" name="hostIds" value={JSON.stringify(selectedHostIds)} />
                <select
                  name="deviceType"
                  value={reclassType}
                  onChange={(e) => setReclassType(e.target.value)}
                  className={selectCls}
                  title="Reclassify the selected discovered hosts (sticky across scans)"
                >
                  {DEVICE_TYPE_OPTIONS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <Button type="submit" variant="outline" size="sm" disabled={reclassifying}>
                  <Tags className="size-4" /> {reclassifying ? "Saving…" : "Reclassify"}
                </Button>
              </form>
              <form action={bulkPurgeAction}>
                <input type="hidden" name="schoolId" value={schoolId} />
                <input type="hidden" name="basePath" value={basePath} />
                <input type="hidden" name="items" value={JSON.stringify(selectedItems)} />
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  disabled={bulkPurging}
                  onClick={(e) => {
                    if (!confirm(`Delete ${selectedRows.length} selected device(s)? They'll be hidden from the inventory + map and sensors stop SNMP-polling them. Restore any from the Excluded tab.`)) e.preventDefault();
                  }}
                >
                  <Trash2 className="size-4" /> {bulkPurging ? "Deleting…" : `Delete ${selectedRows.length}`}
                </Button>
              </form>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" /> Clear
              </button>
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  {isAdmin && (
                    <TableHead className="w-8">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleAllVisible}
                        aria-label="Select all visible"
                        className="size-4 rounded border-input accent-primary"
                      />
                    </TableHead>
                  )}
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
                      {isAdmin && (
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selected.has(r.key)}
                            onChange={() => toggle(r.key)}
                            aria-label={`Select ${r.name}`}
                            className="size-4 rounded border-input accent-primary"
                          />
                        </TableCell>
                      )}
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
                          <div className="flex items-center gap-2">
                            {r.registryId ? (
                              <Link href={`${basePath}/registry/${r.registryId}/edit`} className="text-primary hover:underline" title="Edit"><Pencil className="size-3.5" /></Link>
                            ) : null}
                            <form action={purgeDeviceAction}>
                              <input type="hidden" name="schoolId" value={schoolId} />
                              <input type="hidden" name="basePath" value={basePath} />
                              <input type="hidden" name="key" value={r.key} />
                              <input type="hidden" name="registryId" value={r.registryId ?? ""} />
                              <button type="submit" className="text-muted-foreground hover:text-destructive" title="Purge from inventory + stop SNMP-polling it">
                                <Trash2 className="size-3.5" />
                              </button>
                            </form>
                          </div>
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

      {tab === "excluded" && (
        <div className="overflow-x-auto rounded-lg border">
          {excluded.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Ban className="size-8 text-muted-foreground" />
              <p className="font-medium">No purged devices</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Devices you purge from the inventory land here. Restoring one un-hides
                it and resumes SNMP polling on the next scan.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead className="hidden md:table-cell">IP / MAC</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {excluded.map((e) => (
                  <TableRow key={e.key}>
                    <TableCell className="font-medium">{e.name}</TableCell>
                    <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                      {e.ip ?? "—"}{e.mac ? <div>{e.mac}</div> : null}
                    </TableCell>
                    <TableCell>{e.isSwitch ? "switch" : "host"}</TableCell>
                    <TableCell>
                      <form action={restoreDeviceAction}>
                        <input type="hidden" name="schoolId" value={schoolId} />
                        <input type="hidden" name="basePath" value={basePath} />
                        <input type="hidden" name="key" value={e.key} />
                        <button type="submit" className="inline-flex items-center gap-1 text-sm text-primary hover:underline" title="Restore to inventory">
                          <RotateCcw className="size-3.5" /> Restore
                        </button>
                      </form>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </div>
  );
}
