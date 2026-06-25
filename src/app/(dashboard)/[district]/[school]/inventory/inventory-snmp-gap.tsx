"use client";

import { useActionState } from "react";
import { AlertCircle, CheckCircle2, KeyRound, Radio } from "lucide-react";

import {
  addSnmpCommunityAction,
  type InventoryActionState,
} from "@/lib/inventory/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/section-header";

export interface GapDevice {
  key: string;
  name: string;
  ip: string | null;
  vendor: string | null;
}

export function SnmpGapCard({
  schoolId,
  basePath,
  gaps,
  isAdmin,
}: {
  schoolId: number;
  basePath: string;
  gaps: GapDevice[];
  isAdmin: boolean;
}) {
  const [state, action, pending] = useActionState<InventoryActionState, FormData>(
    addSnmpCommunityAction,
    {},
  );

  if (gaps.length === 0) return null;

  return (
    <Card className="border-[var(--warning)]/40">
      <SectionHeader
        icon={Radio}
        title={`${gaps.length} reachable device${gaps.length === 1 ? "" : "s"} not answering SNMP`}
      />
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          These devices respond to ping/traceroute but aren&apos;t answering SNMP — usually
          a community string the sensor hasn&apos;t tried yet, or an ACL that excludes it.
          Add a community below and the sensor will try it on its next scan; anything it
          unlocks starts reporting (and enriches the map).
        </p>

        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-3 py-2 text-left font-medium">Device</th>
                <th className="px-3 py-2 text-left font-medium">IP</th>
                <th className="hidden px-3 py-2 text-left font-medium sm:table-cell">Vendor</th>
              </tr>
            </thead>
            <tbody>
              {gaps.slice(0, 25).map((g) => (
                <tr key={g.key} className="border-b last:border-0">
                  <td className="px-3 py-1.5">{g.name}</td>
                  <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{g.ip ?? "—"}</td>
                  <td className="hidden px-3 py-1.5 text-muted-foreground sm:table-cell">{g.vendor ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {gaps.length > 25 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">+ {gaps.length - 25} more…</p>
          )}
        </div>

        {isAdmin ? (
          <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <input type="hidden" name="schoolId" value={schoolId} />
            <input type="hidden" name="basePath" value={basePath} />
            <div className="flex flex-1 flex-col gap-1.5">
              <label htmlFor="community" className="text-sm font-medium">SNMP community to try</label>
              <Input id="community" name="community" placeholder="e.g. district-ro" autoComplete="off" className="max-w-xs" />
            </div>
            <Button type="submit" disabled={pending}>
              <KeyRound className="size-4" /> {pending ? "Adding…" : "Add to sensor"}
            </Button>
          </form>
        ) : (
          <p className="text-xs text-muted-foreground">An admin can add an SNMP community to unlock these.</p>
        )}

        {state.error && (
          <p className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="size-4" /> {state.error}
          </p>
        )}
        {state.ok && state.message && (
          <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-4" /> {state.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
