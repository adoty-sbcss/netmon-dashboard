"use client";

import { Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * AI-6: a small button that hands a pre-built prompt to the global assistant
 * widget (via a window event the widget listens for) and opens it. Used on AI
 * finding cards as "Help me fix this" — the live answer is tailored, uses the
 * assistant's real-data tools, and its token usage is metered into the AI-7 cost
 * summary like any other chat turn.
 */
export function AskAssistantButton({
  prompt,
  label = "Help me fix this",
  className,
}: {
  prompt: string;
  label?: string;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      onClick={() =>
        window.dispatchEvent(
          new CustomEvent("netmon:ask-assistant", { detail: { prompt } }),
        )
      }
    >
      <Wrench className="size-3" /> {label}
    </Button>
  );
}
