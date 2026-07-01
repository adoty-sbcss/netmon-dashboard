"use client";

/**
 * WIFI-6: Wi-Fi join configuration portal (school-scoped). Admins define the SSIDs
 * the client-experience battery joins + measures, choose auth (open / WPA2-PSK /
 * PEAP-MSCHAPv2), flag captive portals (with a best-effort click-through), pick
 * shared vs per-sensor credentials (MPSK = per-sensor), enroll sensors, and run a
 * test on demand. Superadmin-only (the page gates rendering). The analysis radio is
 * always routes-off — it can never become a sensor's uplink.
 */
import { useActionState, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Plus,
  Radio,
  ShieldCheck,
  Trash2,
  Wifi,
  Zap,
} from "lucide-react";

import {
  upsertWifiProfileAction,
  deleteWifiProfileAction,
  setProfileSensorAction,
  testWifiExperienceAction,
  type WifiActionState,
} from "@/lib/wifi-join-actions";
import type { WifiProfileRow, SchoolWifiRadio } from "@/db/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/section-header";

function Notice({ state }: { state: WifiActionState }) {
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

const selectCls =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const labelCls = "text-xs text-muted-foreground";

const AUTH_OPTS = [
  { v: "open", label: "Open (no key)" },
  { v: "psk", label: "WPA2-PSK" },
  { v: "peap", label: "WPA2-Enterprise (PEAP-MSCHAPv2)" },
] as const;

/** Shared fields for the add/edit profile form (auth/scope drive which show). */
function ProfileFields({
  profile,
  surveySsids,
}: {
  profile?: WifiProfileRow;
  surveySsids: string[];
}) {
  const [auth, setAuth] = useState(profile?.authMethod ?? "open");
  const [scope, setScope] = useState(profile?.credentialScope ?? "shared");
  const [captive, setCaptive] = useState(profile?.captivePortal ?? false);
  const [scheduled, setScheduled] = useState(profile?.scheduleEnabled ?? false);
  const needsSecret = auth !== "open";
  const needsIdentity = auth === "peap";
  const sharedCreds = scope === "shared" && needsSecret;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <label className={labelCls}>SSID</label>
          <Input
            name="ssid"
            defaultValue={profile?.ssid ?? ""}
            list="wifi-survey-ssids"
            placeholder="sbcss-mpsk"
            className="h-9 w-52 font-mono"
            autoComplete="off"
            maxLength={32}
            required
          />
          <datalist id="wifi-survey-ssids">
            {surveySsids.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Label (optional)</label>
          <Input
            name="label"
            defaultValue={profile?.label ?? ""}
            placeholder="Staff MPSK"
            className="h-9 w-40"
            autoComplete="off"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Authentication</label>
          <select name="authMethod" value={auth} onChange={(e) => setAuth(e.target.value)} className={selectCls}>
            {AUTH_OPTS.map((o) => (
              <option key={o.v} value={o.v}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Credential scope</label>
          <select
            name="credentialScope"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className={selectCls}
            disabled={!needsSecret}
          >
            <option value="shared">Shared (one key for the school)</option>
            <option value="per_sensor">Per-sensor (MPSK / per-box account)</option>
          </select>
        </div>
      </div>

      {/* shared credential fields (only when scope=shared and auth needs a secret) */}
      {sharedCreds && (
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-dashed p-3">
          {needsIdentity && (
            <div className="flex flex-col gap-1">
              <label className={labelCls}>Username (identity)</label>
              <Input
                name="sharedIdentity"
                defaultValue={profile?.sharedIdentity ?? ""}
                placeholder="svc-netmon"
                className="h-9 w-48"
                autoComplete="off"
              />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label className={labelCls}>{needsIdentity ? "Password" : "Pre-shared key"}</label>
            <Input
              name="sharedSecret"
              type="password"
              autoComplete="new-password"
              placeholder={profile?.hasSharedSecret ? "•••••• (blank = keep)" : "enter key"}
              className="h-9 w-56 font-mono"
            />
          </div>
          <span className="text-xs text-muted-foreground">Stored encrypted (AES-256-GCM).</span>
        </div>
      )}
      {scope === "per_sensor" && needsSecret && (
        <p className="text-xs text-muted-foreground">
          Per-sensor keys are entered on each enrolled sensor below (e.g. MPSK, where each
          radio MAC has its own key).
        </p>
      )}

      {/* captive + flags */}
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="captivePortal"
            defaultChecked={profile?.captivePortal ?? false}
            onChange={(e) => setCaptive(e.target.checked)}
            className="size-4"
          />
          Captive portal (click-through)
        </label>
        {captive && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="captiveAutoAccept"
              defaultChecked={profile?.captiveAutoAccept ?? false}
              className="size-4"
            />
            Try to auto-accept
          </label>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isDistrictSsid"
            defaultChecked={profile?.isDistrictSsid ?? true}
            className="size-4"
          />
          Our SSID (authorized)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={profile?.enabled ?? true}
            className="size-4"
          />
          Enabled
        </label>
      </div>

      {/* unattended scheduler — run the battery on a cadence, no manual Test now */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="scheduleEnabled"
            defaultChecked={profile?.scheduleEnabled ?? false}
            onChange={(e) => setScheduled(e.target.checked)}
            className="size-4"
          />
          Auto-test on a schedule
        </label>
        {scheduled && (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            every
            <Input
              name="scheduleIntervalHours"
              type="number"
              min={1}
              max={168}
              defaultValue={profile?.scheduleIntervalHours ?? 6}
              className="h-8 w-16"
            />
            hours
          </span>
        )}
      </div>
    </div>
  );
}

/** Per-sensor enrollment row within a profile (participate + per-sensor creds + test). */
function SensorEnrollRow({
  profile,
  radio,
  basePath,
}: {
  profile: WifiProfileRow;
  radio: SchoolWifiRadio;
  basePath: string;
}) {
  const [setState, setAction, setting] = useActionState<WifiActionState, FormData>(
    setProfileSensorAction,
    {},
  );
  const [testState, testAction, testing] = useActionState<WifiActionState, FormData>(
    testWifiExperienceAction,
    {},
  );
  const assign = profile.sensors.find((s) => s.sensorId === radio.sensorId);
  const perSensor = profile.credentialScope === "per_sensor" && profile.authMethod !== "open";
  const needsIdentity = profile.authMethod === "peap";

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Radio className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">{radio.sensorName}</span>
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{radio.mac}</code>
          <span className="text-xs text-muted-foreground">{radio.interface}</span>
        </div>
        <form action={testAction}>
          <input type="hidden" name="sensorId" value={radio.sensorId} />
          <input type="hidden" name="basePath" value={basePath} />
          <Button type="submit" variant="outline" size="sm" disabled={testing}>
            <Zap className="size-3.5" /> {testing ? "Queuing…" : "Test now"}
          </Button>
        </form>
      </div>
      <form action={setAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="profileId" value={profile.id} />
        <input type="hidden" name="sensorId" value={radio.sensorId} />
        <input type="hidden" name="basePath" value={basePath} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="participate" defaultChecked={assign?.enabled ?? false} className="size-4" />
          Enroll
        </label>
        {perSensor && needsIdentity && (
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Username</label>
            <Input
              name="identity"
              defaultValue={assign?.identity ?? ""}
              placeholder="svc-netmon"
              className="h-8 w-40"
              autoComplete="off"
            />
          </div>
        )}
        {perSensor && (
          <div className="flex flex-col gap-1">
            <label className={labelCls}>{needsIdentity ? "Password" : "Key for this MAC"}</label>
            <Input
              name="secret"
              type="password"
              autoComplete="new-password"
              placeholder={assign?.hasSecret ? "•••••• (blank = keep)" : "enter key"}
              className="h-8 w-52 font-mono"
            />
          </div>
        )}
        <Button type="submit" size="sm" variant="secondary" disabled={setting}>
          {setting ? "Saving…" : "Save"}
        </Button>
        <div className="w-full"><Notice state={setState} /></div>
        {testState.ok || testState.error ? (
          <div className="w-full"><Notice state={testState} /></div>
        ) : null}
      </form>
    </div>
  );
}

/** One profile: summary + edit form + delete + per-sensor enrollment. */
function ProfileCard({
  profile,
  radios,
  surveySsids,
  basePath,
  schoolId,
}: {
  profile: WifiProfileRow;
  radios: SchoolWifiRadio[];
  surveySsids: string[];
  basePath: string;
  schoolId: number;
}) {
  const [saveState, saveAction, saving] = useActionState<WifiActionState, FormData>(
    upsertWifiProfileAction,
    {},
  );
  const [delState, delAction, deleting] = useActionState<WifiActionState, FormData>(
    deleteWifiProfileAction,
    {},
  );
  const enrolled = profile.sensors.filter((s) => s.enabled).length;

  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2">
        <Wifi className="size-4" />
        <span className="font-medium">{profile.label || profile.ssid}</span>
        <code className="font-mono text-xs text-muted-foreground">{profile.ssid}</code>
        <Badge variant="secondary">{profile.authMethod.toUpperCase()}</Badge>
        {profile.captivePortal && <Badge variant="outline">captive</Badge>}
        <Badge variant="outline">
          {profile.credentialScope === "per_sensor" ? "per-sensor key" : "shared key"}
        </Badge>
        {profile.scheduleEnabled && (
          <Badge variant="outline">auto every {profile.scheduleIntervalHours ?? 6}h</Badge>
        )}
        {!profile.enabled && <Badge variant="destructive">disabled</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">
          {enrolled} sensor{enrolled === 1 ? "" : "s"} enrolled
        </span>
      </div>

      <div className="flex flex-col gap-4 p-3">
        <details>
          <summary className="cursor-pointer text-sm font-medium">Edit network</summary>
          <form action={saveAction} className="mt-3 flex flex-col gap-3">
            <input type="hidden" name="schoolId" value={schoolId} />
            <input type="hidden" name="profileId" value={profile.id} />
            <input type="hidden" name="basePath" value={basePath} />
            <ProfileFields profile={profile} surveySsids={surveySsids} />
            <div className="flex items-center gap-3">
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
              <Notice state={saveState} />
            </div>
          </form>
          <form action={delAction} className="mt-2">
            <input type="hidden" name="profileId" value={profile.id} />
            <input type="hidden" name="basePath" value={basePath} />
            <Button type="submit" variant="ghost" size="sm" className="text-destructive" disabled={deleting}>
              <Trash2 className="size-3.5" /> {deleting ? "Deleting…" : "Delete network"}
            </Button>
            <Notice state={delState} />
          </form>
        </details>

        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">Sensors</p>
          {radios.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No sensor at this school reports a spare Wi-Fi radio yet.
            </p>
          ) : (
            radios.map((r) => (
              <SensorEnrollRow key={r.sensorId} profile={profile} radio={r} basePath={basePath} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** The add-a-profile form (collapsed by default). */
function AddProfileForm({
  schoolId,
  basePath,
  surveySsids,
}: {
  schoolId: number;
  basePath: string;
  surveySsids: string[];
}) {
  const [state, action, pending] = useActionState<WifiActionState, FormData>(
    upsertWifiProfileAction,
    {},
  );
  return (
    <details className="rounded-lg border border-dashed p-3">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
        <Plus className="size-4" /> Add a network
      </summary>
      <form action={action} className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="schoolId" value={schoolId} />
        <input type="hidden" name="basePath" value={basePath} />
        <ProfileFields surveySsids={surveySsids} />
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Adding…" : "Add network"}
          </Button>
          <Notice state={state} />
        </div>
      </form>
    </details>
  );
}

export function WifiConfigPortal({
  schoolId,
  basePath,
  profiles,
  radios,
  surveySsids,
}: {
  schoolId: number;
  basePath: string;
  profiles: WifiProfileRow[];
  radios: SchoolWifiRadio[];
  surveySsids: string[];
}) {
  return (
    <Card>
      <SectionHeader icon={Wifi} title="Wi-Fi join configuration" meta="test networks like a client" />
      <CardContent className="flex flex-col gap-4">
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          Define the networks a sensor joins to measure the real client experience (associate,
          DHCP, captive portal, DNS, internet, guest→internal isolation). The analysis radio is
          always <strong>routes-off</strong> — it can never become the box&apos;s uplink. Changes
          apply on the next check-in (~3 min); use <strong>Test now</strong> to run immediately.
        </p>

        {radios.length === 0 ? (
          <p className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
            <AlertCircle className="size-4 shrink-0 text-amber-600" />
            No sensor here reports a spare Wi-Fi radio yet. Enroll a box with a Wi-Fi adapter; its
            radio MAC shows here once it checks in, so you can authorize it on MPSK / MAC-bound nets.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="text-muted-foreground">Radio MACs to authorize upstream:</span>
            {radios.map((r) => (
              <span key={r.sensorId} className="flex items-center gap-1">
                <span className="text-muted-foreground">{r.sensorName}</span>
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{r.mac}</code>
              </span>
            ))}
          </div>
        )}

        {profiles.map((p) => (
          <ProfileCard
            key={p.id}
            profile={p}
            radios={radios}
            surveySsids={surveySsids}
            basePath={basePath}
            schoolId={schoolId}
          />
        ))}

        <AddProfileForm schoolId={schoolId} basePath={basePath} surveySsids={surveySsids} />
      </CardContent>
    </Card>
  );
}
