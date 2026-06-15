"use client";

/**
 * Route-group error boundary for the whole dashboard.
 *
 * Any uncaught error while rendering a dashboard page lands here instead of the
 * bare framework "A server error occurred" full-screen 500. It renders INSIDE
 * the dashboard layout, so the sidebar/nav stay intact and the user can move to
 * another page or retry — one bad query/value can no longer take the app down.
 * Belt-and-suspenders for the class of bug where a single page throws (see
 * asDate() in lib/format for the specific timestamp-coercion fixes).
 */
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the container console (greppable) so a recurrence is diagnosable.
    console.error("[dashboard] page render failed:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <AlertTriangle className="size-10 text-[var(--warning)]" />
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">This page hit a snag</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Something went wrong loading this page. The rest of the dashboard is
          still available from the sidebar. Try again — if it keeps happening,
          let an admin know{error.digest ? "" : "."}
          {error.digest && (
            <>
              {" "}and share this reference:{" "}
              <span className="font-mono">{error.digest}</span>.
            </>
          )}
        </p>
      </div>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
