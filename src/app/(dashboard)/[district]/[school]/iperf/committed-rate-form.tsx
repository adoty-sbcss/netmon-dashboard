"use client";

import { useActionState } from "react";
import { CheckCircle2, AlertCircle, Save } from "lucide-react";

import {
  setSchoolCommittedRateAction,
  type UplinkActionState,
} from "@/lib/uplink-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * PERF-3: inline editor for the school's committed/provisioned WAN rate. Lives in
 * the Uplink utilization section so the admin sets the paid rate right next to the
 * measured throughput. Superadmin-gated by the parent (only rendered when allowed).
 */
export function CommittedRateForm({
  districtSlug,
  schoolSlug,
  committedMbps,
  label,
  note,
}: {
  districtSlug: string;
  schoolSlug: string;
  committedMbps: number | null;
  label: string | null;
  note: string | null;
}) {
  const [state, action, pending] = useActionState<UplinkActionState, FormData>(
    setSchoolCommittedRateAction,
    {},
  );

  return (
    <form action={action} className="flex flex-col gap-3 border-t pt-4">
      <input type="hidden" name="districtSlug" value={districtSlug} />
      <input type="hidden" name="schoolSlug" value={schoolSlug} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="committedMbps" className="text-sm font-medium">
            Committed rate <span className="text-muted-foreground">(Mbps)</span>
          </label>
          <Input
            id="committedMbps"
            name="committedMbps"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            defaultValue={committedMbps ?? ""}
            placeholder="1000"
            className="w-32"
            autoComplete="off"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="rateLabel" className="text-sm font-medium">
            Label <span className="text-muted-foreground">(optional)</span>
          </label>
          <Input
            id="rateLabel"
            name="label"
            defaultValue={label ?? ""}
            placeholder="ISP 1G circuit"
            className="w-48"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="rateNote" className="text-sm font-medium">
            Note <span className="text-muted-foreground">(optional)</span>
          </label>
          <Input
            id="rateNote"
            name="note"
            defaultValue={note ?? ""}
            placeholder="Provisioned transport, not physical port speed"
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          <Save /> {pending ? "Saving…" : "Save rate"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Leave blank and save to clear. Utilization is shown against this rate.
        </p>
        {state.error && (
          <p className="flex items-center gap-1.5 text-sm text-destructive" role="alert">
            <AlertCircle className="size-4 shrink-0" />
            {state.error}
          </p>
        )}
        {state.ok && state.message && (
          <p className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-4 shrink-0" />
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
