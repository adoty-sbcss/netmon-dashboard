"use client";

import { useActionState } from "react";
import { AlertCircle, CheckCircle2, UploadCloud } from "lucide-react";

import { bulkSetSftpAction, type SensorActionState } from "@/lib/admin/sensor-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Fleet-wide SFTP push form (superadmin). Submits to bulkSetSftpAction. */
export function SftpRotationForm({ sensorCount }: { sensorCount: number }) {
  const [state, action, pending] = useActionState<SensorActionState, FormData>(
    bulkSetSftpAction,
    {},
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UploadCloud className="size-4 text-primary" />
          Push SFTP credentials to all {sensorCount} sensor{sensorCount === 1 ? "" : "s"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex max-w-xl flex-col gap-3">
          <input type="hidden" name="basePath" value="/sensors/sftp" />
          <label className="flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              name="sftpEnabled"
              defaultChecked
              className="size-4 rounded border-input accent-primary"
            />
            SFTP uploads enabled
          </label>
          <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
            <Input name="sftpHost" placeholder="sftp host" autoComplete="off" required />
            <Input name="sftpPort" type="number" defaultValue={22} placeholder="22" />
          </div>
          <Input name="sftpUser" placeholder="username" autoComplete="off" required />
          <Input
            name="sftpPassword"
            type="password"
            placeholder="password (blank = keep each box's current)"
            autoComplete="new-password"
          />
          <Input name="sftpRemotePath" defaultValue="/" placeholder="/" />
          {state.error && (
            <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
              <AlertCircle className="size-4 shrink-0" />
              {state.error}
            </p>
          )}
          {state.ok && state.message && (
            <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-4 shrink-0" />
              {state.message}
            </p>
          )}
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? "Pushing…" : "Push to all sensors"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Merges into each box&apos;s existing config (SNMP etc. preserved) and bumps its
            version. Each box applies on its next check-in. Leave the password blank to rotate
            host/user without changing the password.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
