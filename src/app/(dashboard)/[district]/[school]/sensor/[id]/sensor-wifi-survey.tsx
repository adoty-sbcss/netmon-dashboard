"use client";

import { useActionState } from "react";
import { AlertCircle, CheckCircle2, CircleSlash, Wifi } from "lucide-react";

import {
  setSensorWifiSurveyAction,
  type SensorActionState,
} from "@/lib/admin/sensor-actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/section-header";

/**
 * WIFI-2 (admin): enable/disable the passive Wi-Fi RF/AP survey on one sensor.
 * Pushes NETMON_WIFI_SURVEY_ENABLED (+ optional district SSIDs) via desired-config;
 * the box applies it on its next check-in and surfaces data on the Wireless tab.
 */
export function SensorWifiSurvey({
  sensorId,
  basePath,
  enabled,
  currentSsids,
}: {
  sensorId: number;
  basePath: string;
  enabled: boolean;
  currentSsids: string;
}) {
  const [state, formAction, pending] = useActionState<SensorActionState, FormData>(
    setSensorWifiSurveyAction,
    {},
  );

  const notice = state.error ? (
    <p className="flex items-center gap-1.5 text-xs text-destructive" role="alert">
      <AlertCircle className="size-3.5 shrink-0" /> {state.error}
    </p>
  ) : state.ok && state.message ? (
    <p className="flex items-center gap-1.5 text-xs text-[var(--success)]">
      <CheckCircle2 className="size-3.5 shrink-0" /> {state.message}
    </p>
  ) : null;

  return (
    <Card>
      <SectionHeader
        icon={Wifi}
        title="Wi-Fi survey"
        meta={enabled ? "enabled" : "disabled"}
      />
      <CardContent className="flex flex-col gap-3">
        <p className="max-w-prose text-xs text-muted-foreground">
          Passive managed-mode RF/AP survey — enumerates nearby SSIDs / BSSIDs,
          channels, signal and encryption (no association, captures no payloads).
          Needs a Wi-Fi adapter on the sensor. Results appear on the{" "}
          <strong>Wireless</strong> tab after the next hourly bundle (~15 min).
        </p>

        {!enabled ? (
          <form action={formAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="sensorId" value={sensorId} />
            <input type="hidden" name="basePath" value={basePath} />
            <input type="hidden" name="enabled" value="true" />
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">
                District SSIDs (comma-separated, optional — flags your APs vs neighbors)
              </span>
              <input
                name="districtSsids"
                defaultValue={currentSsids}
                placeholder="SBCSS,sbcss-mpsk,SBCSS-Guest"
                className="w-80 max-w-full rounded-md border bg-background px-2 py-1 text-sm"
              />
            </label>
            <Button type="submit" size="sm" disabled={pending}>
              <Wifi className="size-4" /> {pending ? "Enabling…" : "Enable survey"}
            </Button>
          </form>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="default" className="text-[10px] uppercase">
                surveying
              </Badge>
              {currentSsids ? (
                <span>
                  District SSIDs: <span className="font-mono">{currentSsids}</span>
                </span>
              ) : (
                <span>No district SSIDs set (all APs shown as neighbors).</span>
              )}
            </div>
            <form action={formAction}>
              <input type="hidden" name="sensorId" value={sensorId} />
              <input type="hidden" name="basePath" value={basePath} />
              <input type="hidden" name="enabled" value="false" />
              <Button
                type="submit"
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                disabled={pending}
              >
                <CircleSlash className="size-4" /> {pending ? "Disabling…" : "Disable survey"}
              </Button>
            </form>
          </div>
        )}
        {notice}
      </CardContent>
    </Card>
  );
}
