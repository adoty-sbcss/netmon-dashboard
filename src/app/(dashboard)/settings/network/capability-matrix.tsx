"use client";

import { Fragment, useActionState } from "react";
import { AlertCircle, CheckCircle2, Save } from "lucide-react";

import {
  saveSensorCapabilitiesAction,
  type SensorActionState,
} from "@/lib/admin/sensor-actions";
import type { SensorCapabilityRow } from "@/db/settings-queries";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/format";

/** The capability columns, in display order. `key` matches desired_config. */
const CAPABILITIES: { key: keyof SensorCapabilityRow; label: string; hint: string }[] = [
  { key: "snmp_enabled", label: "SNMP", hint: "Poll switches over SNMP (needs a community below)" },
  { key: "snmp_topology_enabled", label: "Spine crawl", hint: "Map the path-to-internet via SNMP/CDP (spine scope)" },
  { key: "sftp_enabled", label: "SFTP upload", hint: "Ship hourly bundles to the dashboard depot" },
  { key: "iperf_enabled", label: "iperf", hint: "Scheduled internal throughput test (needs an iperf server below)" },
  { key: "speedtest_enabled", label: "Speed tests", hint: "Public internet speed test (Cloudflare)" },
  { key: "latency_enabled", label: "Latency", hint: "Latency/jitter/loss to internet + gateway + DNS each check-in" },
];

function Cell({ sensorId, capKey, checked }: { sensorId: number; capKey: string; checked: boolean }) {
  return (
    <td className="px-2 py-2 text-center">
      <input
        type="checkbox"
        name={`cap-${sensorId}-${capKey}`}
        defaultChecked={checked}
        className="size-4 accent-[var(--primary)] align-middle"
        aria-label={capKey}
      />
    </td>
  );
}

/**
 * Per-sensor capability matrix — the single place to turn each capability on/off
 * for any sensor in the district. Uncontrolled checkboxes seeded from desired
 * config; one Save pushes only the rows that changed (server-side diff).
 */
export function CapabilityMatrix({
  basePath,
  sensors,
}: {
  basePath: string;
  sensors: SensorCapabilityRow[];
}) {
  const [state, action, pending] = useActionState<SensorActionState, FormData>(
    saveSensorCapabilitiesAction,
    {},
  );

  if (sensors.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No sensors in this district yet. Deploy one from a school page.
      </p>
    );
  }

  // Group rows by school for readable section headers.
  const groups = new Map<string, SensorCapabilityRow[]>();
  for (const s of sensors) {
    const label = s.schoolName || s.schoolSlug;
    (groups.get(label) ?? groups.set(label, []).get(label)!).push(s);
  }
  const ids = sensors.map((s) => s.id).join(",");

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="sensorIds" value={ids} />
      <input type="hidden" name="basePath" value={basePath} />
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium">Sensor</th>
              {CAPABILITIES.map((c) => (
                <th key={c.key} className="px-2 py-2 text-center font-medium" title={c.hint}>
                  {c.label}
                </th>
              ))}
              <th className="px-3 py-2 text-left font-medium">Last check-in</th>
            </tr>
          </thead>
          <tbody>
            {[...groups.entries()].map(([school, rows]) => (
              <Fragment key={school}>
                <tr className="border-b bg-muted/20">
                  <td colSpan={CAPABILITIES.length + 2} className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                    {school}
                  </td>
                </tr>
                {rows.map((s) => {
                  const pendingSync =
                    s.configVersion != null && s.configVersion !== s.reportedConfigVersion;
                  return (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="sticky left-0 z-10 bg-card px-3 py-2">
                        <span className="font-medium">{s.name || s.slug}</span>
                        <span className="ml-2 font-mono text-xs text-muted-foreground">{s.slug}</span>
                        {pendingSync && (
                          <span className="ml-2 text-[10px] text-[var(--warning)]" title="A config push hasn't been applied by the box yet">
                            sync pending
                          </span>
                        )}
                      </td>
                      {CAPABILITIES.map((c) => (
                        <Cell key={c.key} sensorId={s.id} capKey={c.key} checked={Boolean(s[c.key])} />
                      ))}
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {s.lastCheckinAt ? relativeTime(s.lastCheckinAt) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          <Save className="size-4" /> {pending ? "Saving…" : "Save capabilities"}
        </Button>
        {state.error && (
          <p className="flex items-center gap-1 text-sm text-destructive" role="alert">
            <AlertCircle className="size-4" /> {state.error}
          </p>
        )}
        {state.ok && state.message && (
          <p className="flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-4" /> {state.message}
          </p>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Each change applies on the sensor&apos;s next check-in (~3 min). SNMP needs a community and
        iperf needs a server — set those below. SFTP enables the destination already configured for
        the box.
      </p>
    </form>
  );
}
