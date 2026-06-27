"use client";

import * as React from "react";
import { Tooltip } from "radix-ui";
import { Info } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A small "what's this?" affordance for defining jargon in place. Hover or
 * focus (or tap, on touch) to read a plain-language explanation — typically
 * sourced from `@/lib/glossary`.
 *
 * Pass `children` to turn a word into the trigger (renders with a dotted
 * underline); omit it to get a standalone info icon. The trigger swallows its
 * own click, so it's safe to drop next to other interactive elements.
 */
export function InfoTip({
  content,
  children,
  side = "top",
  className,
  label = "More information",
}: {
  /** The explanation shown in the bubble. */
  content: React.ReactNode;
  /** Optional trigger text/element. Defaults to a small info icon. */
  children?: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
  /** Accessible label for the icon-only variant. */
  label?: string;
}) {
  return (
    <Tooltip.Provider delayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            aria-label={children ? undefined : label}
            onClick={(e) => {
              // Don't trigger a surrounding clickable (e.g. a linked card).
              e.preventDefault();
              e.stopPropagation();
            }}
            className={cn(
              "inline-flex shrink-0 items-center rounded align-middle text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              children &&
                "cursor-help text-inherit underline decoration-dotted decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground",
              className,
            )}
          >
            {children ?? <Info className="size-3.5" aria-hidden />}
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side={side}
            sideOffset={6}
            collisionPadding={8}
            className="z-50 max-w-[16rem] rounded-md border bg-popover px-3 py-2 text-xs leading-relaxed text-popover-foreground shadow-md"
          >
            {content}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
