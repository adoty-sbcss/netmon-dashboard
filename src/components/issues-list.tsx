"use client";

import { useActionState } from "react";
import { Bell, BellOff, Check, CircleCheck, RotateCcw, ShieldCheck } from "lucide-react";

import type { IssueRow } from "@/lib/issues/queries";
import { updateIssueAction, type IssueActionState } from "@/lib/issues/actions";
import { SeverityBadge } from "@/components/severity-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/format";

function IssueActionButton({
  action,
  pending,
  id,
  basePath,
  act,
  label,
  Icon,
}: {
  action: (formData: FormData) => void;
  pending: boolean;
  id: number;
  basePath: string;
  act: string;
  label: string;
  Icon: typeof Check;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value={act} />
      <input type="hidden" name="basePath" value={basePath} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        <Icon className="size-3.5" /> {label}
      </Button>
    </form>
  );
}

function IssueRowActions({
  id,
  status,
  basePath,
}: {
  id: number;
  status: string;
  basePath: string;
}) {
  const [, action, pending] = useActionState<IssueActionState, FormData>(updateIssueAction, {});
  const common = { action, pending, id, basePath };
  if (status === "resolved")
    return <IssueActionButton {...common} act="reopen" label="Reopen" Icon={RotateCcw} />;
  if (status === "muted")
    return <IssueActionButton {...common} act="unmute" label="Unmute" Icon={Bell} />;
  return (
    <div className="flex gap-2">
      {status !== "acknowledged" && (
        <IssueActionButton {...common} act="acknowledge" label="Ack" Icon={Check} />
      )}
      {/* AI-4: stronger than Ack — hide it and stop the AI re-raising it. */}
      <IssueActionButton {...common} act="mute" label="Mute" Icon={BellOff} />
      <IssueActionButton {...common} act="resolve" label="Resolve" Icon={CircleCheck} />
    </div>
  );
}

export function IssuesList({
  issues,
  basePath,
  isAdmin,
  showScope = false,
}: {
  issues: IssueRow[];
  basePath: string;
  isAdmin: boolean;
  showScope?: boolean;
}) {
  if (issues.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <ShieldCheck className="size-8 text-[var(--success)]" />
        <p className="font-medium">No open issues</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Issues are distilled from the AI analysis and check themselves off when they stop
          recurring. Run an analysis to populate this.
        </p>
      </div>
    );
  }
  return (
    <ul className="divide-y">
      {issues.map((i) => (
        <li key={i.id} className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={i.severity} />
              {showScope && <Badge variant="outline" className="text-xs">{i.scopeLabel}</Badge>}
              {i.status === "acknowledged" && (
                <Badge variant="outline" className="text-muted-foreground">acknowledged</Badge>
              )}
              {i.status === "muted" && (
                <Badge variant="outline" className="text-muted-foreground">muted</Badge>
              )}
              {i.status === "resolved" && (
                <Badge variant="outline" className="border-[var(--success)]/40 text-[var(--success)]">resolved</Badge>
              )}
              <span className="font-medium">{i.title}</span>
            </div>
            {i.detail && <p className="text-sm text-muted-foreground">{i.detail}</p>}
            {i.recommendation && (
              <p className="text-sm">
                <span className="font-medium">Fix:</span> {i.recommendation}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              seen {i.occurrences}× · first {i.firstSeenAt ? relativeTime(i.firstSeenAt) : "—"} · last{" "}
              {i.lastSeenAt ? relativeTime(i.lastSeenAt) : "—"}
              {i.resolvedAt ? ` · resolved ${relativeTime(i.resolvedAt)}` : ""}
              {i.source === "ai-topology" ? " · topology" : ""}
            </p>
          </div>
          {isAdmin && <IssueRowActions id={i.id} status={i.status} basePath={basePath} />}
        </li>
      ))}
    </ul>
  );
}
