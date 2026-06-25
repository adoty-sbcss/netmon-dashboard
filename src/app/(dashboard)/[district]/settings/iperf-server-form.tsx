"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, AlertCircle, Gauge } from "lucide-react";

import { saveDistrictIperfAction, type IperfActionState } from "@/lib/iperf-actions";
import type { DistrictIperfView } from "@/lib/iperf";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/section-header";

function Notice({ state }: { state: IperfActionState }) {
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

export function IperfServerForm({
  districtSlug,
  iperf,
}: {
  districtSlug: string;
  iperf: DistrictIperfView;
}) {
  const [enabled, setEnabled] = useState(iperf.enabled);
  const [state, action, saving] = useActionState<IperfActionState, FormData>(
    saveDistrictIperfAction,
    {},
  );

  return (
    <Card className="max-w-2xl">
      <SectionHeader icon={Gauge} title="iperf3 throughput server" />
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="districtSlug" value={districtSlug} />
          <p className="text-sm text-muted-foreground">
            The iperf3 server this district&apos;s sensors test against. Stand up{" "}
            <code>iperf3 -s</code> somewhere reachable, then enable it and point
            sensors here. Per-sensor scheduling + on-demand runs live on each
            sensor&apos;s page.
          </p>
          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              name="enabled"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="size-4 rounded border-input accent-primary"
            />
            <span className="text-sm font-medium">Enable iperf for this district</span>
          </label>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="serverHost" className="text-sm font-medium">
                Server host
              </label>
              <Input
                id="serverHost"
                name="serverHost"
                defaultValue={iperf.serverHost}
                placeholder="iperf.example.org or 203.0.113.5"
                className="w-72 font-mono"
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="serverPort" className="text-sm font-medium">
                Port
              </label>
              <Input
                id="serverPort"
                name="serverPort"
                type="number"
                defaultValue={iperf.serverPort}
                className="w-28"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save iperf server"}
            </Button>
            <Notice state={state} />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
