"use client";

/**
 * Client shell for the Network map page: a Map / Hidden tab toggle. "Map" renders
 * the cytoscape topology + the AI panel (passed in pre-rendered from the server
 * page). "Hidden" lists devices an operator has hidden from the map, each with a
 * one-click restore. Hiding/unhiding is a map-only toggle — the device stays in the
 * inventory and keeps SNMP-polling (see setDeviceMapHidden).
 */
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { EyeOff, Radio, RadioTower, RotateCcw } from "lucide-react";

import type { MapGraph, MapHiddenRow } from "@/db/queries";
import type { CoverageSummary } from "@/lib/topology/coverage";
import { setDeviceMapHidden } from "@/lib/admin/map-actions";
import { CytoscapePhysicalMap } from "@/components/topology/cytoscape-physical-map";
import { DeviceTypeBadge } from "@/components/device-type-badge";
import { DEVICE_TYPE_LABELS, type DeviceType } from "@/lib/oui/types";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type Tab = "map" | "hidden";

export function MapHub({
  graph,
  basePath,
  status,
  schoolId,
  canSave,
  hidden,
  coverage,
  aiPanel,
}: {
  graph: MapGraph;
  basePath: string;
  status: Record<string, string>;
  schoolId: number;
  canSave: boolean;
  hidden: MapHiddenRow[];
  coverage: CoverageSummary;
  aiPanel: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("map");

  return (
    <div className="flex flex-col gap-6">
      <div className="inline-flex w-fit overflow-hidden rounded-lg border text-sm">
        {([
          ["map", "Map"],
          ["hidden", hidden.length ? `Hidden (${hidden.length})` : "Hidden"],
        ] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "px-3 py-1.5",
              tab === t ? "bg-primary text-primary-foreground" : "hover:bg-accent",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "map" ? (
        <>
          <CoverageBanner coverage={coverage} />
          <CytoscapePhysicalMap
            graph={graph}
            basePath={basePath}
            status={status}
            schoolId={schoolId}
            canSave={canSave}
            coveredCidrs={coverage.coveredCidrs}
          />
          {aiPanel}
        </>
      ) : (
        <HiddenList rows={hidden} schoolId={schoolId} basePath={basePath} />
      )}
    </div>
  );
}

/** Plain-English "are we missing a sensor?" line for techs. */
function CoverageBanner({ coverage }: { coverage: CoverageSummary }) {
  const { observedSubnetCount, coveredSubnetCount, blindSubnets, sensorCount } = coverage;
  if (observedSubnetCount === 0) return null;

  const blindCount = blindSubnets.length;
  const blindDevices = blindSubnets.reduce((a, b) => a + b.deviceCount, 0);
  const top = blindSubnets[0];

  if (blindCount === 0) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-[var(--success)]/30 bg-[var(--success)]/5 px-3 py-2 text-sm">
        <Radio className="mt-0.5 size-4 shrink-0 text-[var(--success)]" />
        <p>
          <span className="font-medium">Full Layer-2 coverage.</span>{" "}
          {sensorCount} sensor{sensorCount === 1 ? "" : "s"} collecting across all{" "}
          {observedSubnetCount} observed subnet{observedSubnetCount === 1 ? "" : "s"}.
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-3 py-2 text-sm">
      <RadioTower className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" />
      <p>
        Sensors collect Layer-2 on{" "}
        <span className="font-medium">
          {coveredSubnetCount} of {observedSubnetCount}
        </span>{" "}
        subnets. <span className="font-medium">{blindCount}</span> subnet
        {blindCount === 1 ? "" : "s"} (~{blindDevices} device{blindDevices === 1 ? "" : "s"}) have no
        sensor — their switches show on the map but not what&apos;s attached.
        {top && (
          <>
            {" "}
            Biggest gap: <span className="font-mono">{top.subnet}</span> (~{top.deviceCount} devices
            {top.servingSwitch ? `, served by ${top.servingSwitch}` : ""}). Turn on{" "}
            <span className="font-medium">Coverage</span> to see which devices, or run the AI
            analysis below for sensor-placement recommendations.
          </>
        )}
      </p>
    </div>
  );
}

function HiddenList({
  rows,
  schoolId,
  basePath,
}: {
  rows: MapHiddenRow[];
  schoolId: number;
  basePath: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  function restore(r: MapHiddenRow) {
    setBusyKey(r.key);
    startTransition(async () => {
      const res = await setDeviceMapHidden(schoolId, r.entityKind, r.entityId, false, basePath);
      setBusyKey(null);
      if (res.ok) router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border py-12 text-center">
        <EyeOff className="size-8 text-muted-foreground" />
        <p className="font-medium">No devices hidden from the map</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Right-click a device on the map and choose “Hide from map” to remove it from
          the view and the AI map analysis. It stays in your inventory and keeps
          SNMP-polling. Hidden devices show up here to restore.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Device</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="hidden md:table-cell">IP</TableHead>
            <TableHead className="w-32" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell className="font-medium">{r.name}</TableCell>
              <TableCell>
                <DeviceTypeBadge
                  type={(r.type in DEVICE_TYPE_LABELS ? r.type : "unknown") as DeviceType}
                />
              </TableCell>
              <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                {r.ip ?? "—"}
              </TableCell>
              <TableCell>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending && busyKey === r.key}
                  onClick={() => restore(r)}
                >
                  <RotateCcw className="size-3.5" />
                  {pending && busyKey === r.key ? "Showing…" : "Show on map"}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
