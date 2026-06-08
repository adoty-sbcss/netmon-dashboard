"use client";

import * as React from "react";
import { Loader2, Sparkles, AlertTriangle, KeyRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SeverityBadge } from "@/components/severity-badge";
import { AskAssistantButton } from "@/components/ai-chat/ask-assistant-button";
import { relativeTime } from "@/lib/format";
import type { ProviderDescriptor } from "@/lib/ai/providers/registry";
import type { AnalysisRun, AnalysisRow } from "@/lib/ai/queries";
import { getRunStatus, type StartAnalysisResult } from "@/lib/ai/actions";

const POLL_MS = 3000;

function runHasPending(run: AnalysisRun | null): boolean {
  return !!run && run.rows.some((r) => r.status === "running");
}

export function AiAnalysisPanel({
  runAction,
  providers,
  initialRun,
}: {
  /** Bound server action that starts a run for this scope and returns its runId. */
  runAction: () => Promise<StartAnalysisResult>;
  providers: ProviderDescriptor[];
  initialRun: AnalysisRun | null;
}) {
  const [run, setRun] = React.useState<AnalysisRun | null>(initialRun);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const anyConfigured = providers.some((p) => p.configured);
  const pending = busy || runHasPending(run);

  // Poll while any model in the current run is still running.
  React.useEffect(() => {
    if (!run || !runHasPending(run)) return;
    const runId = run.runId;
    let cancelled = false;
    const timer = setInterval(async () => {
      const res = await getRunStatus(runId);
      if (cancelled) return;
      if (res.run) {
        setRun(res.run);
        if (!runHasPending(res.run)) clearInterval(timer);
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [run]);

  async function onRun() {
    setBusy(true);
    setError(null);
    try {
      const res = await runAction();
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.runId) {
        const status = await getRunStatus(res.runId);
        if (status.run) setRun(status.run);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {run ? (
            <>
              Last analysis {relativeTime(run.createdAt)} ·{" "}
              {run.trigger === "scheduled" ? "scheduled daily run" : "manual run"}
            </>
          ) : (
            "No analysis has been run for this scope yet."
          )}
        </div>
        <Button onClick={onRun} disabled={pending || !anyConfigured}>
          {pending ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Sparkles />
          )}
          {pending ? "Analyzing…" : "Run AI analysis"}
        </Button>
      </div>

      {!anyConfigured && (
        <Card className="border-[var(--warning)]/40">
          <CardContent className="flex items-start gap-3 py-4 text-sm">
            <KeyRound className="mt-0.5 size-4 text-[var(--warning)]" />
            <div>
              <p className="font-medium">No AI provider configured</p>
              <p className="text-muted-foreground">
                Set <code>AZURE_OPENAI_*</code> and/or <code>ANTHROPIC_API_KEY</code>{" "}
                (Key Vault in Azure) to enable analysis. The comparison columns
                light up automatically once a key is present.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-2 py-3 text-sm text-destructive">
            <AlertTriangle className="size-4" />
            {error}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {providers.map((p) => (
          <ModelColumn
            key={p.id}
            provider={p}
            row={run?.rows.find((r) => r.providerId === p.id) ?? null}
          />
        ))}
      </div>
    </div>
  );
}

function ModelColumn({
  provider,
  row,
}: {
  provider: ProviderDescriptor;
  row: AnalysisRow | null;
}) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            {provider.label}
          </span>
          {row?.model && (
            <span className="text-xs font-normal text-muted-foreground">
              {row.model}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 space-y-4 text-sm">
        {!provider.configured ? (
          <p className="text-muted-foreground">Not configured.</p>
        ) : !row ? (
          <p className="text-muted-foreground">No analysis yet.</p>
        ) : row.status === "running" ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Analyzing…
          </p>
        ) : row.status === "failed" ? (
          <p className="flex items-start gap-2 text-destructive">
            <AlertTriangle className="mt-0.5 size-4" />
            {row.error || "Analysis failed."}
          </p>
        ) : (
          <>
            {row.prose && (
              <div className="whitespace-pre-wrap leading-relaxed">
                {row.prose}
              </div>
            )}

            {row.findings.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  {row.findings.length} finding
                  {row.findings.length === 1 ? "" : "s"}
                </p>
                {row.findings.map((f, i) => (
                  <div
                    key={i}
                    className="rounded-lg border bg-muted/30 p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={f.severity} />
                      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {f.confidence}
                      </span>
                      <span className="font-medium">{f.title}</span>
                    </div>
                    {f.detail && <p className="mt-1.5">{f.detail}</p>}
                    {f.evidence && (
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        <span className="font-medium">Evidence:</span> {f.evidence}
                      </p>
                    )}
                    {f.recommendation && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        <span className="font-medium">Next:</span>{" "}
                        {f.recommendation}
                      </p>
                    )}
                    <div className="mt-2">
                      <AskAssistantButton
                        prompt={
                          `Help me with this network finding from the AI analysis.\n` +
                          `Title: ${f.title}\n` +
                          `Severity: ${f.severity} (${f.confidence})\n` +
                          (f.detail ? `Detail: ${f.detail}\n` : "") +
                          (f.evidence ? `Evidence: ${f.evidence}\n` : "") +
                          (f.recommendation ? `Suggested next step: ${f.recommendation}\n` : "") +
                          `\nWalk me through: (1) how to confirm and locate this on the network, ` +
                          `(2) the concrete steps to fix it, and (3) anything related I should also check.`
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">No issues flagged.</p>
            )}

            {(row.tokensIn != null || row.latencyMs != null) && (
              <p className="pt-1 text-[11px] text-muted-foreground">
                {row.tokensIn != null && `${row.tokensIn}→${row.tokensOut ?? "?"} tok`}
                {row.latencyMs != null &&
                  ` · ${(row.latencyMs / 1000).toFixed(1)}s`}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
