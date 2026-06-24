"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Collapses a "recent runs" table to its last-few-hours rows by default. The
 * server renders the whole table (so it works without JS and keeps valid table
 * markup); rows older than the window are tagged with
 * `group-data-[expanded=false]/runs:hidden` and this client wrapper just flips the
 * `data-expanded` flag and counts how many are hidden. No row data crosses the
 * boundary — only the toggle is interactive.
 */
export function CollapsibleRuns({
  olderCount,
  collapsedLabel,
  expandedLabel = "Show less",
  children,
  className,
  triggerClassName,
}: {
  /** How many rows are hidden while collapsed (drives the toggle label). */
  olderCount: number;
  /** Label when collapsed; defaults to "Show all (N older)". */
  collapsedLabel?: string;
  expandedLabel?: string;
  children: React.ReactNode;
  className?: string;
  /** Aligns the toggle with the table content (cards inset their padding differently). */
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div data-expanded={open} className={cn("group/runs", className)}>
      {children}
      {olderCount > 0 && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "mt-2 flex items-center gap-1 text-xs font-medium text-primary hover:underline",
            triggerClassName,
          )}
        >
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
          {open ? expandedLabel : (collapsedLabel ?? `Show all (${olderCount} older)`)}
        </button>
      )}
    </div>
  );
}
