"use client";

import { useActionState, useState } from "react";
import { AlertCircle, CheckCircle2, KeyRound } from "lucide-react";

import {
  saveEnrollmentAction,
  type EnrollmentActionState,
} from "@/lib/sensor/enrollment-actions";
import type { EnrollmentView } from "@/lib/sensor/enrollment";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function EnrollmentSettings({
  enrollment,
  appOrigin,
}: {
  enrollment: EnrollmentView;
  appOrigin: string;
}) {
  const [state, action, saving] = useActionState<EnrollmentActionState, FormData>(
    saveEnrollmentAction,
    {},
  );
  const [enabled, setEnabled] = useState(enrollment.autoEnrollEnabled);
  const labelCls = "text-sm font-medium";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <KeyRound className="size-4 text-primary" />
          Sensor auto-enrollment
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Put one shared <strong>bootstrap key</strong> on every new box (same key
            everywhere). On its first check-in the box self-registers and is issued
            its own token automatically — no per-sensor token copying.
          </p>

          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              name="autoEnrollEnabled"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="size-4 rounded border-input accent-primary"
            />
            <span className={labelCls}>Allow boxes to self-enroll with the bootstrap key</span>
          </label>

          {enrollment.bootstrapKey ? (
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className={labelCls}>Current bootstrap key</p>
              <code className="mt-1 block break-all rounded bg-background px-2 py-1.5 font-mono text-xs select-all">
                {enrollment.bootstrapKey}
              </code>
              <p className="mt-2 text-xs text-muted-foreground">
                On each box, set in <code>/etc/netmon/netmon.env</code>:
              </p>
              <pre className="mt-1 overflow-x-auto rounded bg-background px-2 py-1.5 text-[11px] leading-relaxed">
{`NETMON_DASHBOARD_URL=${appOrigin}
NETMON_BOOTSTRAP_KEY=${enrollment.bootstrapKey}`}
              </pre>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No bootstrap key yet — generate one below.
            </p>
          )}

          <label className="flex items-center gap-2.5">
            <input type="checkbox" name="generate" className="size-4 rounded border-input accent-primary" />
            <span className="text-sm">
              {enrollment.bootstrapKey ? "Generate a new key (rotates — old boxes must update)" : "Generate a key"}
            </span>
          </label>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="newBootstrapKey" className={labelCls}>…or set a custom key</label>
            <Input
              id="newBootstrapKey"
              name="newBootstrapKey"
              placeholder="leave blank to keep the current key"
              autoComplete="off"
              className="max-w-md"
            />
          </div>

          {state.error && (
            <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
              <AlertCircle className="size-4 shrink-0" /> {state.error}
            </p>
          )}
          {state.ok && state.message && (
            <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-4 shrink-0" /> {state.message}
            </p>
          )}

          <div>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
