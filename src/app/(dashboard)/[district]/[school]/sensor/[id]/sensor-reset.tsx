"use client";

import { useActionState, useState } from "react";
import { AlertCircle, CheckCircle2, Eraser } from "lucide-react";

import { resetSensorDataAction, type DataActionState } from "@/lib/admin/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function SensorReset({
  sensorId,
  basePath,
  sensorSlug,
}: {
  sensorId: number;
  basePath: string;
  sensorSlug: string;
}) {
  const [state, action, pending] = useActionState<DataActionState, FormData>(
    resetSensorDataAction,
    {},
  );
  const [confirm, setConfirm] = useState(false);

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Eraser className="size-4 text-destructive" />
          Reset / purge data
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Wipes <strong>all collected data</strong> for this sensor — every scan and the
          discovered devices, topology and saved map layout for its school — while keeping
          the sensor enrolled with its config. Use it after bench-testing a new sensor so it
          starts clean in the field. Manually-registered devices are not touched.
        </p>

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

        {confirm ? (
          <form action={action} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="sensorId" value={sensorId} />
            <input type="hidden" name="basePath" value={basePath} />
            <span className="text-sm">
              Permanently purge all data for <span className="font-mono">{sensorSlug}</span>?
            </span>
            <Button type="submit" variant="destructive" size="sm" disabled={pending}>
              {pending ? "Purging…" : "Yes, purge everything"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <div>
            <Button type="button" variant="outline" size="sm" className="text-destructive" onClick={() => setConfirm(true)}>
              <Eraser className="size-4" /> Reset this sensor&apos;s data
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
