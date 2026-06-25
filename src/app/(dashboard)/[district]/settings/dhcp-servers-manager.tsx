"use client";

import { useActionState } from "react";
import { CheckCircle2, AlertCircle, Plus, Trash2, Server } from "lucide-react";

import {
  addAuthorizedDhcpServerAction,
  removeAuthorizedDhcpServerAction,
  type DhcpPolicyActionState,
} from "@/lib/dhcp-policy-actions";
import type { AuthorizedDhcpServer } from "@/lib/dhcp-policy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/section-header";

function Notice({ state }: { state: DhcpPolicyActionState }) {
  if (state.error) {
    return (
      <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
        <AlertCircle className="size-4 shrink-0" />
        {state.error}
      </p>
    );
  }
  if (state.ok && state.message) {
    return (
      <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-4 shrink-0" />
        {state.message}
      </p>
    );
  }
  return null;
}

export function DhcpServersManager({
  districtSlug,
  servers,
}: {
  districtSlug: string;
  servers: AuthorizedDhcpServer[];
}) {
  const [addState, addAction, adding] = useActionState<DhcpPolicyActionState, FormData>(
    addAuthorizedDhcpServerAction,
    {},
  );
  const [removeState, removeAction] = useActionState<DhcpPolicyActionState, FormData>(
    removeAuthorizedDhcpServerAction,
    {},
  );

  return (
    <Card className="max-w-2xl">
      <SectionHeader icon={Server} title="Authorized DHCP servers" />
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          List your legitimate DHCP servers here. Once set, the DHCP page and AI
          reports treat these as expected and only flag servers that are{" "}
          <em>not</em> on this list as possible rogue servers. Leave it empty to
          flag nothing automatically.
        </p>

        {/* Current list */}
        {servers.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
            No authorized servers yet.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {servers.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-3 py-2">
                <span className="font-mono text-sm">{s.serverIp}</span>
                {s.label && <span className="text-sm">{s.label}</span>}
                {s.note && (
                  <span className="truncate text-xs text-muted-foreground">{s.note}</span>
                )}
                <form action={removeAction} className="ml-auto">
                  <input type="hidden" name="districtSlug" value={districtSlug} />
                  <input type="hidden" name="id" value={s.id} />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive"
                    aria-label={`Remove ${s.serverIp}`}
                  >
                    <Trash2 />
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <Notice state={removeState} />

        {/* Add form */}
        <form action={addAction} className="flex flex-col gap-3 border-t pt-4">
          <input type="hidden" name="districtSlug" value={districtSlug} />
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="serverIp" className="text-sm font-medium">
                Server IP
              </label>
              <Input
                id="serverIp"
                name="serverIp"
                placeholder="10.0.0.10"
                className="w-40 font-mono"
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="label" className="text-sm font-medium">
                Label <span className="text-muted-foreground">(optional)</span>
              </label>
              <Input id="label" name="label" placeholder="Core DHCP" className="w-48" />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <label htmlFor="note" className="text-sm font-medium">
                Note <span className="text-muted-foreground">(optional)</span>
              </label>
              <Input id="note" name="note" placeholder="District office" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={adding}>
              <Plus /> {adding ? "Adding…" : "Add server"}
            </Button>
            <Notice state={addState} />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
