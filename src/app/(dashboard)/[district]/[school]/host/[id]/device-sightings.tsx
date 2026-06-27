"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, History } from "lucide-react";

import type { HostSighting } from "@/db/queries";
import { dateTime, relativeTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

/**
 * Per-scan sighting history for a host, COLLAPSED by default so it no longer
 * dominates the page — the header carries the summary (count, latest, sensors)
 * and "Show all" reveals the full table on demand. (sightings arrive newest-first.)
 */
export function DeviceSightings({ sightings }: { sightings: HostSighting[] }) {
  const [open, setOpen] = useState(false);
  const count = sightings.length;
  const latest = sightings[0]?.startedAt ?? null;
  const sensorCount = new Set(sightings.map((s) => s.sensorSlug)).size;
  // PROV-5 Phase 3: a device dedups to ONE entity by MAC, so multiple VLANs here mean
  // it was seen across VLANs (multi-homed / spanning) — surface that in the summary.
  const vlans = [...new Set(sightings.map((s) => s.vlanId).filter((v): v is number => v != null))].sort(
    (a, b) => a - b,
  );

  const summary =
    count === 0
      ? "none recorded"
      : [
          `${count} across all scans`,
          latest ? `latest ${relativeTime(latest)}` : null,
          sensorCount > 1 ? `${sensorCount} sensors` : null,
          vlans.length ? `VLAN${vlans.length > 1 ? "s" : ""} ${vlans.join(", ")}` : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <Card>
      <SectionHeader
        icon={History}
        title="Sightings"
        meta={summary}
        action={
          count > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
            >
              {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              {open ? "Hide" : "Show all"}
            </Button>
          ) : undefined
        }
      />
      {open && count > 0 && (
        <CardContent className="px-0 sm:px-6">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Sensor</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead className="hidden sm:table-cell">VLAN</TableHead>
                  <TableHead className="hidden md:table-cell">Hostname</TableHead>
                  <TableHead className="hidden lg:table-cell">Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sightings.map((s) => (
                  <TableRow key={s.scanId}>
                    <TableCell title={dateTime(s.startedAt)}>
                      {s.startedAt ? relativeTime(s.startedAt) : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{s.sensorSlug}</TableCell>
                    <TableCell className="font-mono tabular-nums">{s.ip ?? "—"}</TableCell>
                    <TableCell className="hidden tabular-nums sm:table-cell">
                      {s.vlanId != null ? s.vlanId : "—"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{s.hostname ?? "—"}</TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {s.source ? (
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {s.source}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
