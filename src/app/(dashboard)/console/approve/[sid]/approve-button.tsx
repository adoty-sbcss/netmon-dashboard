"use client";

import { useActionState } from "react";
import { AlertCircle, CheckCircle2, ShieldCheck } from "lucide-react";

import {
  approveConsoleSessionAction,
  type SensorActionState,
} from "@/lib/admin/sensor-actions";
import { Button } from "@/components/ui/button";

/** The approve form on the emailed approval page. Posts sid + the per-session
 *  token (from the link) to the server action, which re-checks both. */
export function ApproveButton({ sid, token }: { sid: string; token: string }) {
  const [state, action, pending] = useActionState<SensorActionState, FormData>(
    approveConsoleSessionAction,
    {},
  );

  if (state.ok) {
    return (
      <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-4 shrink-0" /> {state.message}
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="sid" value={sid} />
      <input type="hidden" name="token" value={token} />
      <Button type="submit" disabled={pending}>
        <ShieldCheck className="size-4" />
        {pending ? "Approving…" : "Approve session"}
      </Button>
      {state.error && (
        <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
          <AlertCircle className="size-4 shrink-0" /> {state.error}
        </p>
      )}
    </form>
  );
}
