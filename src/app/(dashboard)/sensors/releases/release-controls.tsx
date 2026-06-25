"use client";

import { useActionState } from "react";
import { AlertCircle, CheckCircle2, Pin } from "lucide-react";

import {
  pinStableReleaseAction,
  setSensorChannelAction,
  type SensorActionState,
} from "@/lib/admin/sensor-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/section-header";
import { Card, CardContent } from "@/components/ui/card";

const selectCls =
  "h-8 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/50";

function Notice({ state }: { state: SensorActionState }) {
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

/** Set / promote the global stable release SHA and push it to the whole fleet. */
export function PinStableForm({ currentSha }: { currentSha: string | null }) {
  const [state, action, pending] = useActionState<SensorActionState, FormData>(
    pinStableReleaseAction,
    {},
  );
  return (
    <Card>
      <SectionHeader icon={Pin} title="Stable release pointer" />
      <CardContent>
        <form action={action} className="flex max-w-xl flex-col gap-3">
          <input type="hidden" name="basePath" value="/sensors/releases" />
          <p className="text-sm text-muted-foreground">
            Current stable: {currentSha ? <code className="font-mono">{currentSha.slice(0, 12)}</code> : <span className="italic">unset (stable boxes track main)</span>}
          </p>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="stableSha" className="text-sm font-medium">Promote a commit SHA to stable</label>
            <Input id="stableSha" name="stableSha" placeholder="e.g. 349541d… (a validated net_mon commit)" autoComplete="off" className="font-mono" />
          </div>
          <Input name="notes" placeholder="notes (optional) — what this release contains" autoComplete="off" />
          <Notice state={state} />
          <div>
            <Button type="submit" disabled={pending}>{pending ? "Pinning…" : "Pin + push to all stable sensors"}</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Sets the fleet&apos;s stable target and pushes <code>update_channel=stable</code> +{" "}
            <code>update_ref</code> to every sensor. Each box converges on its next nightly update.
            Use the per-sensor <strong>canary</strong> channel below to test a new <code>main</code>{" "}
            push on a few boxes <em>before</em> promoting it here.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

/** Per-sensor channel selector (the canary-cohort knob). Submits on change. */
export function ChannelPicker({
  sensorId,
  current,
}: {
  sensorId: number;
  current: string;
}) {
  const [state, action, pending] = useActionState<SensorActionState, FormData>(
    setSensorChannelAction,
    {},
  );
  return (
    <form action={action} className="flex items-center gap-1.5">
      <input type="hidden" name="basePath" value="/sensors/releases" />
      <input type="hidden" name="sensorId" value={sensorId} />
      <select
        name="channel"
        defaultValue={current}
        className={selectCls}
        disabled={pending}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        title={state.error ?? state.message ?? "Set this sensor's update channel"}
      >
        <option value="stable">stable</option>
        <option value="canary">canary</option>
        <option value="hold">hold</option>
      </select>
      {pending && <span className="text-xs text-muted-foreground">…</span>}
    </form>
  );
}
