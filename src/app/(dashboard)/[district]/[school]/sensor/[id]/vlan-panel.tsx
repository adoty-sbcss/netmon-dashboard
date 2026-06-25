"use client";

import { useActionState } from "react";
import { AlertCircle, CheckCircle2, Network, Radar } from "lucide-react";

import {
  saveVlanConfigAction,
  runDetectVlansAction,
  type VlanActionState,
} from "@/lib/vlan-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/section-header";

function Notice({ state }: { state: VlanActionState }) {
  if (state.error)
    return (
      <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
        <AlertCircle className="size-4 shrink-0" /> {state.error}
      </p>
    );
  if (state.ok && state.message)
    return (
      <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-4 shrink-0" /> {state.message}
      </p>
    );
  return null;
}

/**
 * VLAN trunk monitoring (runtime). Set/change the VLANs this box monitors without
 * a reinstall — pushes the config + queues the host action that builds the 802.1Q
 * sub-interfaces (routes-off, auto-revert guarded). "Detect" sniffs the trunk.
 */
export function VlanPanel({
  sensorId,
  basePath,
  currentVlans,
  currentParent,
  currentStatics,
}: {
  sensorId: number;
  basePath: string;
  currentVlans: string;
  currentParent: string;
  currentStatics: string;
}) {
  const [saveState, saveAction, saving] = useActionState<VlanActionState, FormData>(
    saveVlanConfigAction,
    {},
  );
  const [detectState, detectAction, detecting] = useActionState<VlanActionState, FormData>(
    runDetectVlansAction,
    {},
  );

  return (
    <Card>
      <SectionHeader
        icon={Network}
        title="VLAN trunk monitoring"
        meta="802.1Q sub-interfaces"
      />
      <CardContent className="flex flex-col gap-4">
        <p className="text-xs text-muted-foreground">
          For a box on a switch <strong>trunk</strong> port: list the VLANs to monitor. The box adds
          a sub-interface per VLAN (routes-off — your uplink is never touched) and scans each. Not on
          a trunk? Leave this empty. Changes apply on the next check-in (~3 min) and auto-revert if
          the box loses connectivity.
        </p>

        {/* Detect */}
        <form action={detectAction} className="flex flex-wrap items-center gap-2 border-b pb-3">
          <input type="hidden" name="sensorId" value={sensorId} />
          <input type="hidden" name="basePath" value={basePath} />
          <Button type="submit" variant="outline" size="sm" disabled={detecting}>
            <Radar className="size-4" /> {detecting ? "Queuing…" : "Detect VLANs on the trunk"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Sniffs ~8s; the result appears in the command history below.
          </span>
          <div className="w-full"><Notice state={detectState} /></div>
        </form>

        {/* Configure */}
        <form action={saveAction} className="flex flex-col gap-3">
          <input type="hidden" name="sensorId" value={sensorId} />
          <input type="hidden" name="basePath" value={basePath} />
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">VLAN IDs (comma-separated)</label>
              <Input
                name="vlans"
                defaultValue={currentVlans}
                placeholder="10,20,30"
                className="h-9 w-48 font-mono"
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Parent NIC (optional)</label>
              <Input
                name="parent"
                defaultValue={currentParent}
                placeholder="auto (uplink)"
                className="h-9 w-40 font-mono"
                autoComplete="off"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">
              Static IPs for no-DHCP VLANs (optional) — vlan:cidr, comma-separated
            </label>
            <Input
              name="statics"
              defaultValue={currentStatics}
              placeholder="30:10.0.30.9/24,40:10.0.40.9/24"
              className="h-9 w-full max-w-md font-mono text-xs"
              autoComplete="off"
            />
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? "Pushing…" : "Apply VLANs"}
            </Button>
            <Notice state={saveState} />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
