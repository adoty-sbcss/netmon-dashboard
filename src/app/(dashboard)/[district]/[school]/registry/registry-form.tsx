"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Save } from "lucide-react";

import {
  saveRegistryDeviceAction,
  type RegistryActionState,
} from "@/lib/registry/actions";
import type { RegistryDeviceRow } from "@/lib/registry/queries";
import {
  MONITOR_TYPES,
  MONITOR_TYPE_LABELS,
  REGISTRY_DEVICE_TYPES,
  REGISTRY_DEVICE_TYPE_LABELS,
  REGISTRY_STATUSES,
  REGISTRY_STATUS_LABELS,
} from "@/lib/registry/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const selectCls =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
const labelCls = "text-sm font-medium";

function Field({
  label,
  htmlFor,
  children,
  hint,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className={labelCls}>
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function RegistryForm({
  districtId,
  schoolId,
  basePath,
  device,
  snmpCommunity,
}: {
  districtId: number;
  schoolId: number | null;
  basePath: string;
  device?: RegistryDeviceRow | null;
  snmpCommunity?: string | null;
}) {
  const [state, action, pending] = useActionState<RegistryActionState, FormData>(
    saveRegistryDeviceAction,
    {},
  );
  const [deviceType, setDeviceType] = useState(device?.deviceType ?? "switch");
  const [monitorType, setMonitorType] = useState(device?.monitorType ?? "none");
  const editing = Boolean(device);

  return (
    <form action={action} className="flex max-w-2xl flex-col gap-5">
      {device && <input type="hidden" name="id" value={device.id} />}
      <input type="hidden" name="districtId" value={districtId} />
      {schoolId != null && <input type="hidden" name="schoolId" value={schoolId} />}
      <input type="hidden" name="basePath" value={basePath} />

      <Field label="Name" htmlFor="name">
        <Input id="name" name="name" defaultValue={device?.name ?? ""} required autoComplete="off" />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Device type" htmlFor="deviceType">
          <select
            id="deviceType"
            name="deviceType"
            className={selectCls}
            value={deviceType}
            onChange={(e) => setDeviceType(e.target.value)}
          >
            {REGISTRY_DEVICE_TYPES.map((t) => (
              <option key={t} value={t}>
                {REGISTRY_DEVICE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
        {deviceType === "other" && (
          <Field label="Describe type" htmlFor="deviceTypeOther">
            <Input
              id="deviceTypeOther"
              name="deviceTypeOther"
              defaultValue={device?.deviceTypeOther ?? ""}
              placeholder="e.g. door controller"
              autoComplete="off"
            />
          </Field>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="IP address" htmlFor="ip">
          <Input id="ip" name="ip" defaultValue={device?.ip ?? ""} placeholder="10.0.0.1" autoComplete="off" />
        </Field>
        <Field label="MAC address" htmlFor="mac">
          <Input id="mac" name="mac" defaultValue={device?.mac ?? ""} placeholder="aa:bb:cc:dd:ee:ff" autoComplete="off" />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Vendor" htmlFor="vendor" hint="Used to look up end-of-life.">
          <Input id="vendor" name="vendor" defaultValue={device?.vendor ?? ""} placeholder="Cisco" autoComplete="off" />
        </Field>
        <Field label="Model" htmlFor="model" hint="Used to look up end-of-life.">
          <Input id="model" name="model" defaultValue={device?.model ?? ""} placeholder="C9300-48P" autoComplete="off" />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Building" htmlFor="building">
          <Input id="building" name="building" defaultValue={device?.building ?? ""} autoComplete="off" />
        </Field>
        <Field label="Room / IDF" htmlFor="room">
          <Input id="room" name="room" defaultValue={device?.room ?? ""} autoComplete="off" />
        </Field>
        <Field label="Current firmware" htmlFor="firmwareCurrent">
          <Input id="firmwareCurrent" name="firmwareCurrent" defaultValue={device?.firmwareCurrent ?? ""} autoComplete="off" />
        </Field>
      </div>

      <div className="rounded-lg border border-input p-3">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Monitor type" htmlFor="monitorType" hint="How we expect to reach it. No login credentials are stored yet.">
            <select
              id="monitorType"
              name="monitorType"
              className={selectCls}
              value={monitorType}
              onChange={(e) => setMonitorType(e.target.value)}
            >
              {MONITOR_TYPES.map((t) => (
                <option key={t} value={t}>
                  {MONITOR_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          {monitorType === "snmp" && (
            <Field
              label="SNMP community"
              htmlFor="snmpCommunity"
              hint={editing && snmpCommunity ? "A value is stored. Leave blank to keep it." : "Read-only community string."}
            >
              <Input
                id="snmpCommunity"
                name="snmpCommunity"
                type="password"
                defaultValue=""
                placeholder={editing && snmpCommunity ? "•••••••• (stored)" : "public"}
                autoComplete="off"
              />
            </Field>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Status" htmlFor="status">
          <select id="status" name="status" className={selectCls} defaultValue={device?.status ?? "active"}>
            {REGISTRY_STATUSES.map((st) => (
              <option key={st} value={st}>
                {REGISTRY_STATUS_LABELS[st]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Notes" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          defaultValue={device?.notes ?? ""}
          rows={3}
          className={selectCls + " h-auto py-2"}
          placeholder="Anything useful for whoever maintains this device."
        />
      </Field>

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

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          <Save className="size-4" />
          {pending ? "Saving…" : editing ? "Save changes" : "Add device"}
        </Button>
        <Button asChild variant="outline">
          <Link href={`${basePath}/registry`}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
