"use client";

import { useActionState } from "react";
import { AlertCircle, CheckCircle2, ShieldCheck } from "lucide-react";

import {
  approvePendingConsoleSessionAction,
  type SensorActionState,
} from "@/lib/admin/sensor-actions";
import type { PendingConsoleApproval } from "@/db/settings-queries";
import { Button } from "@/components/ui/button";
import { dateTime, relativeTime } from "@/lib/format";

function ApprovalRow({ item }: { item: PendingConsoleApproval }) {
  const [state, action, pending] = useActionState<SensorActionState, FormData>(
    approvePendingConsoleSessionAction,
    {},
  );
  const label = item.sensorName || item.sensorSlug;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
      <div className="flex min-w-[16rem] flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">
          {label} <span className="font-mono text-xs text-muted-foreground">{item.sensorSlug}</span>
        </span>
        <span className="text-xs text-muted-foreground">
          {item.districtName} · {item.schoolName} · requested by {item.requestedByEmail ?? "—"}
          {" · "}
          <span title={dateTime(item.createdAt)}>{relativeTime(item.createdAt)}</span>
        </span>
      </div>
      {state.ok ? (
        <span className="flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="size-4" /> Approved
        </span>
      ) : (
        <form action={action}>
          <input type="hidden" name="sid" value={item.sid} />
          <Button type="submit" size="sm" disabled={pending}>
            <ShieldCheck className="size-4" /> {pending ? "Approving…" : "Approve"}
          </Button>
        </form>
      )}
      {state.error && (
        <span className="flex w-full items-center gap-1 text-xs text-destructive" role="alert">
          <AlertCircle className="size-3.5" /> {state.error}
        </span>
      )}
    </div>
  );
}

export function ApprovalsList({ items }: { items: PendingConsoleApproval[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No console sessions are waiting for approval right now.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <ApprovalRow key={item.sid} item={item} />
      ))}
    </div>
  );
}
