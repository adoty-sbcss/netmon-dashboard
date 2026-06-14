import { AlertTriangle, CheckCircle2, Info, List } from "lucide-react";

import type { HelpArticle, HelpBlock } from "@/lib/help/articles";
import { CodeBlock } from "./code-block";
import { HelpImage } from "./help-image";

const CALLOUT = {
  info: { Icon: Info, cls: "border-sky-500/30 bg-sky-500/5 text-sky-700 dark:text-sky-300" },
  warn: { Icon: AlertTriangle, cls: "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300" },
  success: { Icon: CheckCircle2, cls: "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300" },
} as const;

/** Stable anchor id from a heading's text (for the table of contents). */
function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function Block({ block }: { block: HelpBlock }) {
  switch (block.kind) {
    case "h":
      return (
        <h2
          id={headingId(block.text)}
          className="mt-8 mb-2 scroll-mt-24 text-base font-semibold tracking-tight"
        >
          {block.text}
        </h2>
      );
    case "p":
      return <p className="my-2 text-sm leading-relaxed text-foreground/90">{block.text}</p>;
    case "steps":
      return (
        <ol className="my-3 ml-5 list-decimal space-y-1.5 text-sm leading-relaxed text-foreground/90 marker:text-muted-foreground">
          {block.items.map((it, i) => (
            <li key={i} className="pl-1">
              {it}
            </li>
          ))}
        </ol>
      );
    case "code":
      return <CodeBlock code={block.code} caption={block.caption} />;
    case "image":
      return <HelpImage src={block.src} alt={block.alt} caption={block.caption} />;
    case "callout": {
      const { Icon, cls } = CALLOUT[block.tone];
      return (
        <div className={`my-3 flex items-start gap-2.5 rounded-lg border p-3 text-sm ${cls}`}>
          <Icon className="mt-0.5 size-4 shrink-0" />
          <div className="leading-relaxed">{block.text}</div>
        </div>
      );
    }
    default:
      return null;
  }
}

export function HelpArticleView({ article }: { article: HelpArticle }) {
  const headings = article.blocks
    .filter((b): b is Extract<HelpBlock, { kind: "h" }> => b.kind === "h")
    .map((b) => b.text);

  return (
    <article className="max-w-3xl">
      {headings.length >= 3 && (
        <nav className="mb-2 rounded-lg border bg-muted/30 p-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <List className="size-3.5" /> On this page
          </p>
          <ul className="flex flex-col gap-1">
            {headings.map((h) => (
              <li key={h}>
                <a href={`#${headingId(h)}`} className="text-sm text-primary hover:underline">
                  {h}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {article.blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </article>
  );
}
