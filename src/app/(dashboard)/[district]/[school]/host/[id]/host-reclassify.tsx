"use client";

import { useActionState } from "react";
import { AlertCircle, CheckCircle2, Tags } from "lucide-react";

import {
  setHostDeviceTypeAction,
  clearHostDeviceTypeAction,
} from "@/lib/inventory/snmp-control";
import type { InventoryActionState } from "@/lib/inventory/actions";
import { DEVICE_TYPE_LABELS, type DeviceType } from "@/lib/oui/types";
import { Button } from "@/components/ui/button";

/** Reclassify options — mirrors the inventory bulk-reclassify list + the action's
 *  allow-list (everything except the auto-only "randomized"). */
const OPTIONS: DeviceType[] = [
  "switch", "router", "ap", "firewall", "printer", "phone", "camera",
  "computer", "server", "mobile", "storage", "media", "display", "iot", "vm", "unknown",
];

const selectCls =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Per-device manual reclassify (superadmin). Sets a sticky deviceTypeOverride that
 * wins over the auto type everywhere and survives re-scans; "Reset to auto" clears
 * it. Shown next to the device-type badge on the host page.
 */
export function HostReclassify({
  hostId,
  basePath,
  current,
  override,
  auto,
}: {
  hostId: number;
  basePath: string;
  current: DeviceType | null;
  override: DeviceType | null;
  auto: DeviceType | null;
}) {
  const [state, action, pending] = useActionState<InventoryActionState, FormData>(
    setHostDeviceTypeAction,
    {},
  );
  const [clrState, clrAction, clearing] = useActionState<InventoryActionState, FormData>(
    clearHostDeviceTypeAction,
    {},
  );

  const err = state.error || clrState.error;
  const ok = (state.ok && state.message) || (clrState.ok && clrState.message);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <form action={action} className="flex items-center gap-2">
          <input type="hidden" name="hostId" value={hostId} />
          <input type="hidden" name="basePath" value={basePath} />
          <select
            name="deviceType"
            defaultValue={current ?? "unknown"}
            className={selectCls}
            aria-label="Device type"
          >
            {OPTIONS.map((t) => (
              <option key={t} value={t}>
                {DEVICE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            <Tags className="size-4" /> {pending ? "Saving…" : "Set type"}
          </Button>
        </form>
        {override && (
          <form action={clrAction}>
            <input type="hidden" name="hostId" value={hostId} />
            <input type="hidden" name="basePath" value={basePath} />
            <Button type="submit" size="sm" variant="ghost" disabled={clearing}>
              {clearing ? "Resetting…" : "Reset to auto"}
            </Button>
          </form>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {override
          ? `Manually classified${auto ? ` · auto-detected: ${DEVICE_TYPE_LABELS[auto]}` : ""}`
          : "Auto-detected. Set a type to override it (sticks across future scans)."}
      </p>
      {err && (
        <p className="flex items-center gap-1 text-sm text-destructive" role="alert">
          <AlertCircle className="size-4" /> {err}
        </p>
      )}
      {ok && (
        <p className="flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="size-4" /> {state.message || clrState.message}
        </p>
      )}
    </div>
  );
}
