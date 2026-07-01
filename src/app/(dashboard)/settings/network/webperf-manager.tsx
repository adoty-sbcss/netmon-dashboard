"use client";

import { useActionState } from "react";
import { CheckCircle2, AlertCircle, Globe, Plus, Trash2 } from "lucide-react";

import {
  setWebperfEnabledAction,
  addWebperfUrlAction,
  removeWebperfUrlAction,
  type WebperfActionState,
} from "@/lib/webperf-actions";
import type { WebperfUrl } from "@/lib/webperf";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/section-header";

function Notice({ state }: { state: WebperfActionState }) {
  if (state.error)
    return (
      <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
        <AlertCircle className="size-4 shrink-0" /> {state.error}
      </p>
    );
  if (state.ok && state.message)
    return (
      <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-4 shrink-0" /> {state.message}
      </p>
    );
  return null;
}

/** PERF-5: district-managed website list + enable switch. Pushes to all the
 *  district's sensors; results render on each school's Speed & Bandwidth tab. */
export function WebperfManager({
  districtSlug,
  enabled,
  urls,
  defaults,
}: {
  districtSlug: string;
  enabled: boolean;
  urls: WebperfUrl[];
  defaults: string[];
}) {
  const [enState, enAction, enPending] = useActionState<WebperfActionState, FormData>(
    setWebperfEnabledAction,
    {},
  );
  const [addState, addAction, adding] = useActionState<WebperfActionState, FormData>(
    addWebperfUrlAction,
    {},
  );
  const [rmState, rmAction] = useActionState<WebperfActionState, FormData>(
    removeWebperfUrlAction,
    {},
  );

  return (
    <Card>
      <SectionHeader icon={Globe} title="Website / end-user experience" meta="synthetic web checks" />
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Each sensor loads these sites and reports the full timing breakdown — DNS, connect, TLS,
          time-to-first-byte, and total — so you can see <em>where</em> a site is slow (name
          resolution vs the network vs the origin). Results show on each school&apos;s{" "}
          <strong>Speed &amp; Bandwidth</strong> tab.
        </p>

        {/* enable toggle */}
        <form action={enAction} className="flex flex-wrap items-center gap-3 border-b pb-4">
          <input type="hidden" name="districtSlug" value={districtSlug} />
          <input type="hidden" name="enabled" value={enabled ? "" : "on"} />
          <Button type="submit" size="sm" variant={enabled ? "outline" : "default"} disabled={enPending}>
            {enPending ? "Saving…" : enabled ? "Turn off" : "Turn on website testing"}
          </Button>
          <span className="text-sm">
            {enabled ? (
              <span className="text-emerald-600 dark:text-emerald-400">On for this district</span>
            ) : (
              <span className="text-muted-foreground">Off</span>
            )}
          </span>
          <div className="w-full">
            <Notice state={enState} />
          </div>
        </form>

        {/* current list */}
        {urls.length === 0 ? (
          <div className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
            No custom sites yet — testing the defaults:
            {defaults.map((d) => (
              <code key={d} className="mx-1 font-mono text-xs">
                {d}
              </code>
            ))}
            . Add your LMS, SIS, or the state testing portal below.
          </div>
        ) : (
          <ul className="divide-y rounded-lg border">
            {urls.map((u) => (
              <li key={u.id} className="flex items-center gap-3 px-3 py-2">
                <span className="truncate font-mono text-sm">{u.url}</span>
                {u.label && <span className="text-sm text-muted-foreground">{u.label}</span>}
                <form action={rmAction} className="ml-auto">
                  <input type="hidden" name="districtSlug" value={districtSlug} />
                  <input type="hidden" name="id" value={u.id} />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive"
                    aria-label={`Remove ${u.url}`}
                  >
                    <Trash2 />
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <Notice state={rmState} />

        {/* add form */}
        <form action={addAction} className="flex flex-col gap-3 border-t pt-4">
          <input type="hidden" name="districtSlug" value={districtSlug} />
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <label htmlFor="wp-url" className="text-sm font-medium">
                Website URL
              </label>
              <Input
                id="wp-url"
                name="url"
                placeholder="https://classroom.google.com"
                className="font-mono"
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="wp-label" className="text-sm font-medium">
                Label <span className="text-muted-foreground">(optional)</span>
              </label>
              <Input id="wp-label" name="label" placeholder="Google Classroom" className="w-48" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={adding}>
              <Plus /> {adding ? "Adding…" : "Add site"}
            </Button>
            <Notice state={addState} />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
