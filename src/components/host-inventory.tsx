"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpDown, ChevronRight, Search } from "lucide-react";

import type { HostRow } from "@/db/queries";
import { relativeTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
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
  const [sortKey, setSortKey] = useState<SortKey>("ip");
  const [asc, setAsc] = useState(true);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? hosts.filter((h) =>
          [h.hostname, h.vendor, h.mac, h.ip]
            .filter(Boolean)
            .some((v) => v!.toLowerCase().includes(q)),
        )
      : hosts;

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
  }, [hosts, query, sortKey, asc]);

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
      <div className="flex items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search host, vendor, MAC, IP…"
            className="pl-8"
          />
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
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
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
