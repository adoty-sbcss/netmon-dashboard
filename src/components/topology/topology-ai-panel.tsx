"use client";

import { useState } from "react";
import { AlertCircle, Loader2, Sparkles } from "lucide-react";

import {
  analyzeTopologyAction,
  getTopologyRunAction,
} from "@/lib/ai/topology-actions";
import type { AnalysisRun } from "@/lib/ai/queries";
import { relativeTime } from "@/lib/format";
import { SeverityBadge } from "@/components/severity-badge";
import { SectionHeader } from "@/components/section-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function TopologyAiPanel({
  districtSlug,
  schoolSlug,
  canRun,
  initialRun,
}: {
  districtSlug: string;
  schoolSlug: string;
  canRun: boolean;
  initialRun: AnalysisRun | null;
}) {
  const [run, setRun] = useState<AnalysisRun | null>(initialRun);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyze() {
    setError(null);
    setRunning(true);
    try {
      const res = await analyzeTopologyAction(districtSlug, schoolSlug);
      if (res.error || !res.runId) {
        setError(res.error ?? "Could not start the analysis.");
        setRunning(false);
        return;
      }
      // Poll until no model is still 'running' (cap ~2 min).
      for (let i = 0; i < 40; i++) {
        await sleep(3000);
        const r = await getTopologyRunAction(res.runId);
        if (r) {
          setRun(r);
          if (!r.rows.some((row) => row.status === "running")) break;
        }
      }
    } catch {
      setError("The analysis failed to run.");
    } finally {
      setRunning(false);
    }
  }

  const okRows = (run?.rows ?? []).filter((r) => r.status === "ok");
  const failedRows = (run?.rows ?? []).filter((r) => r.status === "failed");
  const stillRunning = running || (run?.rows ?? []).some((r) => r.status === "running");

  return (
    <Card>
      <SectionHeader
        icon={Sparkles}
        title="AI topology review"
        meta={run ? `last run ${relativeTime(run.createdAt)}` : undefined}
        action={
          canRun ? (
            <Button
              type="button"
              size="sm"
              onClick={analyze}
              disabled={stillRunning}
            >
              {stillRunning ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {stillRunning ? "Analyzing…" : run ? "Re-analyze layout" : "Analyze layout"}
            </Button>
          ) : undefined
        }
      />
      <CardContent className="flex flex-col gap-4">
        {error && (
          <p className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="size-4" /> {error}
          </p>
        )}

        {!run && !stillRunning && (
          <p className="text-sm text-muted-foreground">
            Have the AI read this site&apos;s physical layout and the inventory, and flag
            design issues — single points of failure, daisy-chained switches, SNMP blind
            spots, oversubscription. {canRun ? "Click “Analyze layout”." : "An admin can run it."}
          </p>
        )}

        {stillRunning && !okRows.length && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Reading the topology and inventory…
          </p>
        )}

        {okRows.map((row) => {
          const findings = [...row.findings].sort(
            (a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9),
          );
          return (
            <div key={row.id} className="flex flex-col gap-3">
              {okRows.length > 1 && (
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {row.model ?? row.providerId}
                </p>
              )}
              {row.prose && <p className="whitespace-pre-wrap text-sm leading-relaxed">{row.prose}</p>}
              {findings.length > 0 && (
                <ul className="flex flex-col gap-3">
                  {findings.map((f, i) => (
                    <li key={i} className="flex items-start gap-3 rounded-lg border p-3">
                      <SeverityBadge severity={f.severity} />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{f.title}</p>
                        {f.detail && <p className="mt-0.5 text-sm text-muted-foreground">{f.detail}</p>}
                        {f.recommendation && (
                          <p className="mt-1 text-sm">
                            <span className="font-medium">Do: </span>
                            {f.recommendation}
                          </p>
                        )}
                        {f.evidence && (
                          <p className="mt-1 font-mono text-[11px] text-muted-foreground">{f.evidence}</p>
                        )}
                        {f.confidence === "suggestive" && (
                          <p className="mt-0.5 text-[11px] text-muted-foreground">low confidence — verify</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}

        {failedRows.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {failedRows.length} model(s) failed: {failedRows[0].error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
