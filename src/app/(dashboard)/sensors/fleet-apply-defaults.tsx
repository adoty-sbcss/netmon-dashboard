"use client";

import { useActionState } from "react";
import { AlertCircle, CheckCircle2, Sparkles } from "lucide-react";

import {
  bulkApplyRecommendedDefaultsAction,
  type SensorActionState,
} from "@/lib/admin/sensor-actions";
import { Button } from "@/components/ui/button";

/**
 * Fleet-wide "Apply recommended defaults" — turns on the SNMP spine crawl + both
 * public speed tests for every sensor (companion to the new-install defaults).
 * Superadmin only (the action re-checks authorization server-side).
 */
export function FleetApplyDefaults() {
  const [state, action, pending] = useActionState<SensorActionState, FormData>(
    bulkApplyRecommendedDefaultsAction,
    {},
  );
  return (
    <div className="flex flex-col items-end gap-1">
      <form action={action}>
        <input type="hidden" name="basePath" value="/sensors" />
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          <Sparkles className="size-4" />
          {pending ? "Applying…" : "Apply recommended defaults"}
        </Button>
      </form>
      {state.error && (
        <p className="flex items-center gap-1 text-xs text-destructive" role="alert">
          <AlertCircle className="size-3.5" />
          {state.error}
        </p>
      )}
      {state.ok && state.message && (
        <p className="flex max-w-xs items-center gap-1 text-right text-xs text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="size-3.5 shrink-0" />
          {state.message}
        </p>
      )}
    </div>
  );
}
