"use client";

/**
 * Superadmin destructive delete for a district or school, gated by typed-slug
 * confirmation. On success the server action redirects (district → overview,
 * school → district), so there's no success state to handle here.
 */
import { useActionState, useState } from "react";
import { Trash2, Loader2, TriangleAlert } from "lucide-react";

import {
  deleteDistrictAction,
  deleteSchoolAction,
  type ProvisionActionState,
} from "@/lib/admin/provisioning-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function DeleteLandingSpot({
  kind,
  slug,
  districtSlug,
}: {
  kind: "district" | "school";
  slug: string;
  districtSlug?: string;
}) {
  const [open, setOpen] = useState(false);
  const action = kind === "district" ? deleteDistrictAction : deleteSchoolAction;
  const [state, formAction, pending] = useActionState<ProvisionActionState, FormData>(action, {});

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-4" /> Delete {kind}
      </Button>
    );
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3"
    >
      {kind === "school" && <input type="hidden" name="districtSlug" value={districtSlug ?? ""} />}
      <input type="hidden" name="slug" value={slug} />
      <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
        <TriangleAlert className="size-3.5" />
        Permanently delete this {kind} and everything in it
        {kind === "district" ? " (schools, sensors, collected data, SFTP user)" : " (its sensors + collected data)"}.
      </p>
      <label className="text-xs text-muted-foreground">
        Type <span className="font-mono font-semibold text-foreground">{slug}</span> to confirm:
      </label>
      <div className="flex flex-wrap gap-2">
        <Input name="confirm" autoFocus placeholder={slug} className="h-9 w-56" disabled={pending} />
        <Button type="submit" size="sm" variant="destructive" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : `Delete ${kind}`}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
      {state.error && <p className="text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
