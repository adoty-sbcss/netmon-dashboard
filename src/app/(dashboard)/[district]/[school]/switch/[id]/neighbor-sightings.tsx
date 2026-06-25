"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Waypoints } from "lucide-react";

import type { SwitchAppearance } from "@/db/queries";
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

const DEFAULT_SHOWN = 2;

/**
 * LLDP/CDP neighbor sightings for a switch — collapsed to the 2 most recent by
 * default (newest-first) so the page isn't dominated by a long history; "Show all"
 * reveals the rest. (Neighbor sightings carry no severity, so there's nothing to
 * always-surface beyond recency.)
 */
export function NeighborSightings({ appearances }: { appearances: SwitchAppearance[] }) {
  const [open, setOpen] = useState(false);
  const count = appearances.length;
  const shown = open ? appearances : appearances.slice(0, DEFAULT_SHOWN);

  return (
    <Card>
      <SectionHeader
        icon={Waypoints}
        title="Neighbor sightings"
        meta={
          count === 0
            ? "none recorded"
            : `${count} — how sensors see this switch on the wire`
        }
        action={
          count > DEFAULT_SHOWN ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
            >
              {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              {open ? "Show less" : `Show all ${count}`}
            </Button>
          ) : undefined
        }
      />
      <CardContent className="px-0 sm:px-6">
        {count === 0 ? (
          <p className="px-6 py-6 text-sm text-muted-foreground">
            No neighbor sightings recorded.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Sensor</TableHead>
                  <TableHead>Local port</TableHead>
                  <TableHead className="hidden md:table-cell">Remote port</TableHead>
                  <TableHead className="hidden lg:table-cell">VLAN</TableHead>
                  <TableHead className="hidden lg:table-cell">Proto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((a) => (
                  <TableRow key={a.scanId}>
                    <TableCell title={dateTime(a.startedAt)}>
                      {a.startedAt ? relativeTime(a.startedAt) : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{a.sensorSlug}</TableCell>
                    <TableCell className="font-mono text-xs">{a.localPort ?? "—"}</TableCell>
                    <TableCell className="hidden font-mono text-xs md:table-cell">
                      {a.portId ?? a.portDescription ?? "—"}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">{a.vlanId ?? "—"}</TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {a.protocol ? (
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {a.protocol}
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
        )}
      </CardContent>
    </Card>
  );
}
