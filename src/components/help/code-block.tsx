"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** A copy-to-clipboard code block. Commands are meant to be pasted verbatim. */
export function CodeBlock({ code, caption }: { code: string; caption?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked (e.g. insecure context) — user can still select manually
    }
  }

  return (
    <figure className="my-3">
      <div className="relative rounded-lg border bg-muted/50">
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy to clipboard"}
          className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground transition hover:text-foreground"
        >
          {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
        <pre className="overflow-x-auto p-3 pr-20 text-[13px] leading-relaxed">
          <code>{code}</code>
        </pre>
      </div>
      {caption && (
        <figcaption className="mt-1 text-xs text-muted-foreground">{caption}</figcaption>
      )}
    </figure>
  );
}
