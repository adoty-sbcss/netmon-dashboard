"use client";

import { useState } from "react";
import { ThumbsUp, ThumbsDown, Check } from "lucide-react";

import { recordHelpFeedback } from "@/lib/help/actions";
import { Button } from "@/components/ui/button";

/** "Was this helpful?" — the per-article half of the feedback loop. A thumbs-down
 *  opens an optional note so we learn what was missing. */
export function ArticleFeedback({ slug }: { slug: string }) {
  const [state, setState] = useState<"idle" | "down" | "done">("idle");
  const [note, setNote] = useState("");

  async function vote(helpful: boolean) {
    if (helpful) {
      await recordHelpFeedback(slug, true);
      setState("done");
    } else {
      // capture the down-vote immediately; the note is an optional add-on
      await recordHelpFeedback(slug, false);
      setState("down");
    }
  }

  if (state === "done") {
    return (
      <p className="mt-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <Check className="size-4 text-emerald-600" /> Thanks for the feedback.
      </p>
    );
  }

  return (
    <div className="mt-6 max-w-3xl border-t pt-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">Was this helpful?</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => vote(true)}>
            <ThumbsUp className="size-4" /> Yes
          </Button>
          <Button variant="outline" size="sm" onClick={() => vote(false)}>
            <ThumbsDown className="size-4" /> No
          </Button>
        </div>
      </div>
      {state === "down" && (
        <form
          className="mt-3 flex max-w-lg flex-col gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            await recordHelpFeedback(slug, false, note);
            setState("done");
          }}
        >
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Optional: what were you looking for, or what's missing?"
            className="rounded-md border border-input bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <Button type="submit" size="sm" className="w-fit">
            Send
          </Button>
        </form>
      )}
    </div>
  );
}
