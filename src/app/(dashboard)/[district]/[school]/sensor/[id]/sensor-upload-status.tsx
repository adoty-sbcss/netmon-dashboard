"use client";

import { useActionState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  CircleSlash,
  Clock,
  Upload,
} from "lucide-react";

import { setSensorUploadsAction, type SensorActionState } from "@/lib/admin/sensor-actions";
import { Button } from "@/components/ui/button";

/**
 * The staging guardrail banner on a sensor's detail page. A newly deployed box
 * starts with SFTP uploads OFF so prep-time scans never pollute the destination
 * school; this is where an operator flips uploads on once the box is installed.
 * Three states, driven by desired (what we want) vs reported (what the box says):
 *   - staging   (!desired)            → "not uploading yet" + Mark installed
 *   - pending   (desired, !reported)  → "starting…" waiting for next check-in
 *   - uploading (desired &&  reported)→ "uploading" + a quiet Pause control
 */
export function SensorUploadStatus({
  sensorId,
  basePath,
  desiredEnabled,
  reportedEnabled,
  hasCheckedIn,
}: {
  sensorId: number;
  basePath: string;
  desiredEnabled: boolean;
  reportedEnabled: boolean | null;
  hasCheckedIn: boolean;
}) {
  const [state, formAction, pending] = useActionState<SensorActionState, FormData>(
    setSensorUploadsAction,
    {},
  );

  const hidden = (
    <>
      <input type="hidden" name="sensorId" value={sensorId} />
      <input type="hidden" name="basePath" value={basePath} />
    </>
  );

  const notice = state.error ? (
    <p className="mt-2 flex items-center gap-1.5 text-xs text-destructive" role="alert">
      <AlertCircle className="size-3.5 shrink-0" /> {state.error}
    </p>
  ) : state.ok && state.message ? (
    <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--success)]">
      <CheckCircle2 className="size-3.5 shrink-0" /> {state.message}
    </p>
  ) : null;

  // ── Staging: uploads off, the box is parked. The loud, actionable state. ──
  if (!desiredEnabled) {
    return (
      <div className="rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/5 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium">
              <CircleSlash className="size-4 text-[var(--warning)]" /> Staging — not uploading to
              the dashboard yet
            </p>
            <p className="mt-1 max-w-prose text-xs text-muted-foreground">
              This sensor is scanning locally but <strong>not shipping data</strong>, so prepping it
              here won&apos;t pollute the site with staging data. Once it&apos;s installed at its
              destination, mark it installed to start hourly uploads.
            </p>
          </div>
          <form action={formAction}>
            {hidden}
            <input type="hidden" name="enabled" value="true" />
            <Button type="submit" size="sm" disabled={pending}>
              <Upload className="size-4" /> {pending ? "Starting…" : "Mark installed & start uploading"}
            </Button>
          </form>
        </div>
        {notice}
      </div>
    );
  }

  // ── Pending: we asked for uploads but the box hasn't confirmed yet. ──
  if (!reportedEnabled) {
    return (
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Clock className="size-4 text-primary" /> Starting uploads…
            </p>
            <p className="mt-1 max-w-prose text-xs text-muted-foreground">
              Uploads are switched on. The sensor applies it on its{" "}
              {hasCheckedIn ? "next check-in" : "first check-in"} (usually a few minutes) and then
              ships its bundles.
            </p>
          </div>
          <form action={formAction}>
            {hidden}
            <input type="hidden" name="enabled" value="false" />
            <Button type="submit" size="sm" variant="ghost" className="text-muted-foreground" disabled={pending}>
              {pending ? "…" : "Cancel"}
            </Button>
          </form>
        </div>
        {notice}
      </div>
    );
  }

  // ── Uploading: confirmed live. Compact reassurance + a quiet pause. ──
  return (
    <div className="rounded-lg border border-[var(--success)]/30 bg-[var(--success)]/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium">
          <CheckCircle2 className="size-4 text-[var(--success)]" /> Uploading to the dashboard
        </p>
        <form action={formAction}>
          {hidden}
          <input type="hidden" name="enabled" value="false" />
          <Button type="submit" size="sm" variant="ghost" className="text-muted-foreground" disabled={pending}>
            <CircleSlash className="size-4" /> {pending ? "Pausing…" : "Pause uploads"}
          </Button>
        </form>
      </div>
      {notice}
    </div>
  );
}
