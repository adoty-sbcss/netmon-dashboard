"use client";

import { useActionState, useState } from "react";
import { AlertCircle, Archive, RotateCcw, Trash2 } from "lucide-react";

import {
  retireRegistryDeviceAction,
  restoreRegistryDeviceAction,
  deleteRegistryDeviceAction,
  type RegistryActionState,
} from "@/lib/registry/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function RegistryDangerZone({
  deviceId,
  basePath,
  retired,
}: {
  deviceId: number;
  basePath: string;
  retired: boolean;
}) {
  const [retireState, retireAction, retiring] = useActionState<RegistryActionState, FormData>(
    retireRegistryDeviceAction,
    {},
  );
  const [restoreState, restoreAction, restoring] = useActionState<RegistryActionState, FormData>(
    restoreRegistryDeviceAction,
    {},
  );
  const [delState, delAction, deleting] = useActionState<RegistryActionState, FormData>(
    deleteRegistryDeviceAction,
    {},
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-input p-4">
      <h2 className="text-sm font-semibold">Lifecycle</h2>

      {retired ? (
        <form action={restoreAction} className="flex items-center gap-3">
          <input type="hidden" name="id" value={deviceId} />
          <input type="hidden" name="basePath" value={basePath} />
          <Button type="submit" variant="outline" size="sm" disabled={restoring}>
            <RotateCcw className="size-4" /> {restoring ? "Restoring…" : "Restore to active"}
          </Button>
        </form>
      ) : (
        <form action={retireAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <input type="hidden" name="id" value={deviceId} />
          <input type="hidden" name="basePath" value={basePath} />
          <div className="flex flex-1 flex-col gap-1.5">
            <label htmlFor="reason" className="text-sm font-medium">Retirement reason</label>
            <Input id="reason" name="reason" placeholder="e.g. replaced by C9300, decommissioned" autoComplete="off" />
          </div>
          <Button type="submit" variant="outline" size="sm" disabled={retiring}>
            <Archive className="size-4" /> {retiring ? "Retiring…" : "Retire device"}
          </Button>
        </form>
      )}
      {(retireState.error || restoreState.error) && (
        <p className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="size-4" /> {retireState.error || restoreState.error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Retiring keeps the record (and its history) but marks it inactive. Use delete only to fix an entry mistake.
      </p>

      <div className="border-t pt-3">
        {confirmDelete ? (
          <form action={delAction} className="flex items-center gap-2">
            <input type="hidden" name="id" value={deviceId} />
            <input type="hidden" name="basePath" value={basePath} />
            <span className="text-sm">Permanently delete this entry?</span>
            <Button type="submit" variant="destructive" size="sm" disabled={deleting}>
              {deleting ? "Deleting…" : "Yes, delete"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="size-4" /> Delete entry
          </Button>
        )}
        {delState.error && (
          <p className="mt-2 flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="size-4" /> {delState.error}
          </p>
        )}
      </div>
    </div>
  );
}
