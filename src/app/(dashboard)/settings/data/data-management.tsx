"use client";

import { useActionState, useState } from "react";
import {
  AlertCircle,
  Building2,
  CalendarX2,
  CheckCircle2,
  Pencil,
  Radio,
  School,
  Trash2,
} from "lucide-react";

import {
  renameEntityAction,
  deleteEntityAction,
  purgeScansAction,
  type DataActionState,
} from "@/lib/admin/actions";
import type { ManagedDistrict } from "@/db/queries";
import { dateTime, num, relativeTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

type Kind = "district" | "school" | "sensor";
type Action = "rename" | "delete" | "purge";

interface EditorTarget {
  action: Action;
  kind: Kind;
  id: number;
  slug: string;
  name: string | null;
}

function Notice({ state }: { state: DataActionState }) {
  if (state.error)
    return (
      <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
        <AlertCircle className="size-4 shrink-0" />
        {state.error}
      </p>
    );
  if (state.ok && state.message)
    return (
      <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-4 shrink-0" />
        {state.message}
      </p>
    );
  return null;
}

export function DataManagement({ tree }: { tree: ManagedDistrict[] }) {
  const [editor, setEditor] = useState<EditorTarget | null>(null);

  const [renameState, renameAction, renaming] = useActionState<DataActionState, FormData>(
    renameEntityAction,
    {},
  );
  const [deleteState, deleteAction, deleting] = useActionState<DataActionState, FormData>(
    deleteEntityAction,
    {},
  );
  const [purgeState, purgeAction, purging] = useActionState<DataActionState, FormData>(
    purgeScansAction,
    {},
  );

  function open(action: Action, kind: Kind, e: { id: number; slug: string; name: string | null }) {
    setEditor((cur) =>
      cur && cur.action === action && cur.kind === kind && cur.id === e.id
        ? null
        : { action, kind, id: e.id, slug: e.slug, name: e.name },
    );
  }

  function isOpen(action: Action, kind: Kind, id: number) {
    return editor?.action === action && editor.kind === kind && editor.id === id;
  }

  const labelCls = "text-xs font-medium text-muted-foreground";

  function ActionButtons({
    kind,
    e,
  }: {
    kind: Kind;
    e: { id: number; slug: string; name: string | null };
  }) {
    return (
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => open("rename", kind, e)}
        >
          <Pencil className="size-3.5" /> Rename
        </Button>
        {kind === "sensor" && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => open("purge", kind, e)}
          >
            <CalendarX2 className="size-3.5" /> Purge
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs text-destructive hover:text-destructive"
          onClick={() => open("delete", kind, e)}
        >
          <Trash2 className="size-3.5" /> Delete
        </Button>
      </div>
    );
  }

  function Editor({ kind, e }: { kind: Kind; e: { id: number; slug: string; name: string | null } }) {
    if (isOpen("rename", kind, e.id)) {
      return (
        <form action={renameAction} className="mt-2 flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={e.id} />
          <label className={labelCls}>Display name (slug “{e.slug}” stays the mapping key)</label>
          <div className="flex flex-wrap gap-2">
            <Input name="name" defaultValue={e.name ?? ""} placeholder={e.slug} className="max-w-xs" autoFocus />
            <Button type="submit" size="sm" disabled={renaming}>
              {renaming ? "Saving…" : "Save name"}
            </Button>
          </div>
          <Notice state={renameState} />
        </form>
      );
    }
    if (isOpen("delete", kind, e.id)) {
      return (
        <form action={deleteAction} className="mt-2 flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={e.id} />
          <p className="text-sm">
            This permanently deletes the {kind} <span className="font-mono">{e.slug}</span> and all
            data beneath it. To confirm, type the slug{" "}
            <span className="font-mono font-semibold">{e.slug}</span>.
          </p>
          <div className="flex flex-wrap gap-2">
            <Input name="confirm" placeholder={e.slug} className="max-w-xs" autoComplete="off" autoFocus />
            <Button type="submit" size="sm" variant="destructive" disabled={deleting}>
              {deleting ? "Deleting…" : `Delete ${kind}`}
            </Button>
          </div>
          <Notice state={deleteState} />
        </form>
      );
    }
    if (isOpen("purge", kind, e.id)) {
      return (
        <form action={purgeAction} className="mt-2 flex flex-col gap-2 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/5 p-3">
          <input type="hidden" name="sensorId" value={e.id} />
          <p className="text-sm">
            Delete collected scans (and their captured hosts/DHCP/STP/etc.) from{" "}
            <span className="font-mono">{e.slug}</span> in a date window. Canonical inventory is
            kept. Leave one side blank for an open-ended bound.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label className={labelCls}>From</label>
              <Input type="date" name="from" className="w-40" />
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelCls}>To (inclusive)</label>
              <Input type="date" name="to" className="w-40" />
            </div>
            <Button type="submit" size="sm" variant="destructive" disabled={purging}>
              {purging ? "Purging…" : "Purge scans"}
            </Button>
          </div>
          <Notice state={purgeState} />
        </form>
      );
    }
    return null;
  }

  if (tree.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No districts yet. Data appears here once the first bundle is ingested.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {tree.map((d) => (
        <Card key={d.id}>
          <CardContent className="flex flex-col gap-2 p-4">
            {/* District */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Building2 className="size-4 text-primary" />
                <span className="font-semibold">{d.name}</span>
                <Badge variant="outline" className="font-mono text-[10px]">{d.slug}</Badge>
              </div>
              <ActionButtons kind="district" e={d} />
            </div>
            <Editor kind="district" e={d} />

            {/* Schools */}
            <div className="mt-1 flex flex-col gap-2 border-l pl-4">
              {d.schools.length === 0 && (
                <p className="text-sm text-muted-foreground">No schools.</p>
              )}
              {d.schools.map((s) => (
                <div key={s.id} className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <School className="size-4 text-muted-foreground" />
                      <span className="font-medium">{s.name || s.slug}</span>
                      <Badge variant="outline" className="font-mono text-[10px]">{s.slug}</Badge>
                    </div>
                    <ActionButtons kind="school" e={s} />
                  </div>
                  <Editor kind="school" e={s} />

                  {/* Sensors / IDFs */}
                  <div className="flex flex-col gap-2 border-l pl-4">
                    {s.sensors.length === 0 && (
                      <p className="text-xs text-muted-foreground">No sensors.</p>
                    )}
                    {s.sensors.map((sen) => (
                      <div key={sen.id} className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <Radio className="size-4 text-muted-foreground" />
                            <span className="text-sm font-medium">{sen.name || sen.slug}</span>
                            <Badge variant="outline" className="font-mono text-[10px]">{sen.slug}</Badge>
                            <span className="text-xs text-muted-foreground">
                              {num(sen.scanCount)} scan{sen.scanCount === 1 ? "" : "s"}
                              {sen.lastScanAt && (
                                <span title={dateTime(sen.lastScanAt)}>
                                  {" "}· last {relativeTime(sen.lastScanAt)}
                                </span>
                              )}
                            </span>
                          </div>
                          <ActionButtons kind="sensor" e={sen} />
                        </div>
                        <Editor kind="sensor" e={sen} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
