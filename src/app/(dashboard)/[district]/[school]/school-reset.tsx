"use client";

import { useActionState, useState } from "react";
import { AlertCircle, CheckCircle2, Eraser } from "lucide-react";

import { resetSchoolDataAction, type DataActionState } from "@/lib/admin/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function SchoolDataReset({
  schoolId,
  basePath,
  schoolSlug,
  schoolName,
}: {
  schoolId: number;
  basePath: string;
  schoolSlug: string;
  schoolName: string;
}) {
  const [state, action, pending] = useActionState<DataActionState, FormData>(
    resetSchoolDataAction,
    {},
  );
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Eraser className="size-4 text-destructive" />
          Reset school data
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Wipes <strong>all collected and curated data</strong> for{" "}
          <strong>{schoolName || schoolSlug}</strong> and starts it over clean: every
          scan and its history, discovered devices &amp; topology, the saved map
          layout, daily rollups, throughput history, manually-entered/imported
          devices, AI reports and the issues list.{" "}
          <strong>Kept:</strong> the sensor(s), their enrollment and all settings — so
          collection continues and fresh data rebuilds automatically. The SFTP ledger
          is preserved, so previously-imported bundles won&apos;t be re-imported and
          rebuild the old data.
        </p>
        <p className="text-xs text-muted-foreground">
          Discovered data is shared per school, so this affects every sensor at the
          school. This cannot be undone.
        </p>

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

        {open ? (
          <form action={action} className="flex flex-col gap-2">
            <input type="hidden" name="schoolId" value={schoolId} />
            <input type="hidden" name="basePath" value={basePath} />
            <label htmlFor="reset-confirm" className="text-sm">
              Type <span className="font-mono font-semibold">{schoolSlug}</span> to
              confirm:
            </label>
            <Input
              id="reset-confirm"
              name="confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={schoolSlug}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              className="max-w-xs font-mono"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                variant="destructive"
                size="sm"
                disabled={pending || typed.trim() !== schoolSlug}
              >
                {pending ? "Purging…" : "Permanently reset this school"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setOpen(false);
                  setTyped("");
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-destructive"
              onClick={() => setOpen(true)}
            >
              <Eraser className="size-4" /> Reset this school&apos;s data
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
