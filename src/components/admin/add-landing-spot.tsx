"use client";

/**
 * PROV-2a: superadmin inline form to create a district or school landing spot.
 * Collapsed to a button; expands to a name field. On success, refreshes so the
 * new spot appears in the list.
 */
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2 } from "lucide-react";

import {
  createDistrictAction,
  createSchoolAction,
  type ProvisionActionState,
} from "@/lib/admin/provisioning-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AddLandingSpot({
  kind,
  districtSlug,
}: {
  kind: "district" | "school";
  districtSlug?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const action = kind === "district" ? createDistrictAction : createSchoolAction;
  const [state, formAction, pending] = useActionState<ProvisionActionState, FormData>(action, {});

  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      router.refresh();
    }
  }, [state.ok, router]);

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Add {kind}
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2 rounded-lg border p-3">
      {kind === "school" && <input type="hidden" name="districtSlug" value={districtSlug ?? ""} />}
      <label className="text-xs font-medium text-muted-foreground">
        {kind === "district" ? "District name" : "School / site name"}
      </label>
      <div className="flex gap-2">
        <Input
          name="name"
          autoFocus
          placeholder={kind === "district" ? "Example County USD" : "Lincoln Elementary"}
          className="h-9 w-64"
          disabled={pending}
        />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : "Create"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        A URL-safe slug is derived from the name (e.g. “{kind === "district" ? "example-county-usd" : "lincoln-elementary"}”).
      </p>
      {state.error && <p className="text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
