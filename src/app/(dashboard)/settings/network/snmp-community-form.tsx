"use client";

import { useActionState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";

import {
  bulkSetSnmpCommunityAction,
  type SensorActionState,
} from "@/lib/admin/sensor-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * District-wide SNMP community push. SNMP discovery does nothing without a
 * community, so this is the companion to the SNMP/Spine columns in the matrix.
 * Pushes the same community to every sensor in the district.
 */
export function SnmpCommunityForm({
  districtId,
  basePath,
  current,
}: {
  districtId: number;
  basePath: string;
  current: string;
}) {
  const [state, action, pending] = useActionState<SensorActionState, FormData>(
    bulkSetSnmpCommunityAction,
    {},
  );
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="districtId" value={districtId} />
      <input type="hidden" name="basePath" value={basePath} />
      <label className="text-sm font-medium">SNMP community (district-wide)</label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          name="snmpCommunities"
          defaultValue={current}
          placeholder="e.g. public, or a comma-separated list"
          className="h-9 max-w-sm font-mono text-xs"
          autoComplete="off"
          spellCheck={false}
        />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Pushing…" : "Push to all sensors"}
        </Button>
      </div>
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
      <p className="text-xs text-muted-foreground">
        Read-only SNMP. Pushed to every sensor in this district; each applies on its next check-in.
      </p>
    </form>
  );
}
