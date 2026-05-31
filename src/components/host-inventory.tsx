"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpDown, ChevronRight, Search } from "lucide-react";

import type { HostRow } from "@/db/queries";
import type { DeviceType } from "@/lib/oui/types";
import { DEVICE_TYPE_LABELS } from "@/lib/oui/types";
import { relativeTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { DeviceTypeBadge } from "@/components/device-type-badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type SortKey = "ip" | "hostname" | "vendor" | "mac" | "lastSeenAt";

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** Sort IPs numerically by octet, falling back to natural compare. */
function ipKey(ip: string | null): number[] {
  if (!ip) return [999, 999, 999, 999];
  const parts = ip.split(".").map((p) => Number.parseInt(p, 10));
  return parts.length === 4 && parts.every((n) => !Number.isNaN(n))
    ? parts
    : [998, 998, 998, 998];
}

export function HostInventory({
  hosts,
  basePath,
}: {
  hosts: HostRow[];
  /** e.g. "/district/school" — host detail links append "/host/{id}". */
  basePath: string;
}) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<DeviceType | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey>("ip");
  const [asc, setAsc] = useState(true);

  // Device types actually present, with counts, for the filter dropdown.
  const typeCounts = useMemo(() => {
    const m = new Map<DeviceType, number>();
    for (const h of hosts) {
      const t = (h.deviceType ?? "unknown") as DeviceType;
      m.set(t, (m.get(t) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [hosts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = q
      ? hosts.filter((h) =>
          [h.hostname, h.vendor, h.mac, h.ip, h.deviceType]
            .filter(Boolean)
            .some((v) => v!.toLowerCase().includes(q)),
        )
      : hosts;
    if (typeFilter !== "all") {
      rows = rows.filter((h) => (h.deviceType ?? "unknown") === typeFilter);
    }

    const sorted = [...rows].sort((a, b) => {
      let cmp: number;
      if (sortKey === "ip") {
        const ka = ipKey(a.ip);
        const kb = ipKey(b.ip);
        cmp = ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2] || ka[3] - kb[3];
      } else if (sortKey === "lastSeenAt") {
        cmp =
          (a.lastSeenAt?.getTime() ?? 0) - (b.lastSeenAt?.getTime() ?? 0);
      } else {
        cmp = collator.compare(a[sortKey] ?? "", b[sortKey] ?? "");
      }
      return asc ? cmp : -cmp;
    });
    return sorted;
  }, [hosts, query, typeFilter, sortKey, asc]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setAsc((v) => !v);
    } else {
      setSortKey(key);
      setAsc(true);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search host, vendor, MAC, IP…"
              className="pl-8"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as DeviceType | "all")}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          >
            <option value="all">All types ({hosts.length})</option>
            {typeCounts.map(([t, n]) => (
              <option key={t} value={t}>
                {DEVICE_TYPE_LABELS[t]} ({n})
              </option>
            ))}
          </select>
        </div>
        <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
          {filtered.length} of {hosts.length}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <SortHead label="IP" col="ip" sortKey={sortKey} onClick={toggleSort} />
              <SortHead label="Hostname" col="hostname" sortKey={sortKey} onClick={toggleSort} />
              <TableHead>Type</TableHead>
              <SortHead
                label="Vendor"
                col="vendor"
                sortKey={sortKey}
                onClick={toggleSort}
                className="hidden md:table-cell"
              />
              <SortHead
                label="MAC"
                col="mac"
                sortKey={sortKey}
                onClick={toggleSort}
                className="hidden lg:table-cell"
              />
              <TableHead className="hidden md:table-cell">Port</TableHead>
              <SortHead
                label="Last seen"
                col="lastSeenAt"
                sortKey={sortKey}
                onClick={toggleSort}
                className="hidden sm:table-cell"
              />
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  No hosts match.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((h) => {
                const linkable = h.entityId != null;
                return (
                  <TableRow
                    key={h.key}
                    className={
                      linkable
                        ? "relative cursor-pointer hover:bg-accent/40"
                        : undefined
                    }
                  >
                    <TableCell className="font-mono tabular-nums">
                      {h.ip ?? "—"}
                    </TableCell>
                    <TableCell className="font-medium">
                      {/* Stretched link: covers the whole row, keeps real anchor semantics. */}
                      {linkable ? (
                        <Link
                          href={`${basePath}/host/${h.entityId}`}
                          className="outline-none after:absolute after:inset-0 focus-visible:underline"
                        >
                          {h.hostname ?? "unknown"}
                        </Link>
                      ) : (
                        h.hostname ?? <span className="text-muted-foreground">unknown</span>
                      )}
                      {h.source && (
                        <Badge variant="outline" className="relative ml-2 text-[10px] uppercase">
                          {h.source}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <DeviceTypeBadge type={h.deviceType} className="relative" />
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {h.vendor ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs lg:table-cell">
                      {h.mac ?? "—"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {h.switchPort ? (
                        <Badge variant="outline" className="relative font-mono text-xs">
                          {h.switchPort}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                      {h.lastSeenAt ? relativeTime(h.lastSeenAt) : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {linkable && <ChevronRight className="size-4" />}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function SortHead({
  label,
  col,
  sortKey,
  onClick,
  className,
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  onClick: (col: SortKey) => void;
  className?: string;
}) {
  const active = sortKey === col;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onClick(col)}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {label}
        <ArrowUpDown
          className={`size-3 ${active ? "text-foreground" : "text-muted-foreground/50"}`}
        />
      </button>
    </TableHead>
  );
}
