import Link from "next/link";
import { Sparkles, ArrowRight } from "lucide-react";

import type { LatestAiSummary } from "@/lib/ai/queries";
import { relativeTime } from "@/lib/format";
import { SeverityBadge } from "@/components/severity-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const MAX_FINDINGS = 6;

/**
 * Surfaces the latest AI analysis for a scope inside the Findings area / district
 * overview. Server component — no interactivity; links to the full AI page.
 */
export function AiFindingsCard({
  summary,
  href,
  title = "AI analysis",
}: {
  summary: LatestAiSummary | null;
  /** Link to the full per-scope AI page (comparison + Run button). */
  href: string;
  title?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Sparkles className="size-4 text-primary" />
          {title}
          {summary && (
            <span className="text-sm font-normal text-muted-foreground">
              {relativeTime(summary.createdAt)} ·{" "}
              {summary.trigger === "scheduled" ? "daily run" : "manual run"}
              {summary.providerCount > 1 ? ` · ${summary.providerCount} models` : ""}
            </span>
          )}
          <Link
            href={href}
            className="ml-auto inline-flex items-center gap-1 text-sm font-normal text-primary hover:underline"
          >
            Full analysis <ArrowRight className="size-3.5" />
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {!summary ? (
          <p className="text-muted-foreground">
            No AI analysis has run for this scope yet.{" "}
            <Link href={href} className="text-primary hover:underline">
              Run one →
            </Link>
          </p>
        ) : summary.providerCount === 0 ? (
          <p className="text-muted-foreground">
            The latest run hasn&apos;t produced results yet (still running or
            failed). <Link href={href} className="text-primary hover:underline">Open it →</Link>
          </p>
        ) : (
          <>
            {summary.prose && (
              <div className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                {summary.prose}
              </div>
            )}
            {summary.findings.length > 0 ? (
              <div className="space-y-2">
                {summary.findings.slice(0, MAX_FINDINGS).map((f, i) => (
                  <div key={i} className="rounded-lg border bg-muted/30 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={f.severity} />
                      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {f.confidence}
                      </span>
                      <span className="font-medium">{f.title}</span>
                      {f.model && (
                        <span className="ml-auto text-[11px] text-muted-foreground">
                          {f.model}
                        </span>
                      )}
                    </div>
                    {f.detail && <p className="mt-1.5">{f.detail}</p>}
                    {f.recommendation && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        <span className="font-medium">Next:</span> {f.recommendation}
                      </p>
                    )}
                  </div>
                ))}
                {summary.findings.length > MAX_FINDINGS && (
                  <Link href={href} className="text-sm text-primary hover:underline">
                    +{summary.findings.length - MAX_FINDINGS} more in the full analysis →
                  </Link>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground">
                No issues flagged by AI in the latest run.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
