"use client";

import { useActionState } from "react";
import { AlertCircle, ArrowUpCircle, CheckCircle2 } from "lucide-react";

import { bulkQueueUpdateAction, type SensorActionState } from "@/lib/admin/sensor-actions";
import { Button } from "@/components/ui/button";

/** Fleet-wide "Update all" — queues a code update for every sensor. Superadmin
 *  only (the action re-checks authorization server-side). */
export function FleetUpdateAll() {
  const [state, action, pending] = useActionState<SensorActionState, FormData>(
    bulkQueueUpdateAction,
    {},
  );
  return (
    <div className="flex flex-col items-end gap-1">
      <form action={action}>
        <input type="hidden" name="basePath" value="/sensors" />
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          <ArrowUpCircle className="size-4" />
          {pending ? "Queuing…" : "Update all"}
        </Button>
      </form>
      {state.error && (
        <p className="flex items-center gap-1 text-xs text-destructive" role="alert">
          <AlertCircle className="size-3.5" />
          {state.error}
        </p>
      )}
      {state.ok && state.message && (
        <p className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="size-3.5" />
          {state.message}
        </p>
      )}
    </div>
  );
}
