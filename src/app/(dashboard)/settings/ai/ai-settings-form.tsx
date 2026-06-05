"use client";

import { useActionState, useState } from "react";
import {
  CheckCircle2,
  AlertCircle,
  PlugZap,
  Sparkles,
  KeyRound,
  BarChart3,
  Activity,
} from "lucide-react";

import { relativeTime } from "@/lib/format";

import {
  saveProviderAction,
  testProviderAction,
  saveAiSettingsAction,
  uploadAssistantAvatarAction,
  clearAssistantAvatarAction,
  type AiSettingsActionState,
} from "@/lib/ai/actions";
import type { AiProviderSettingsView, AiGlobalSettings } from "@/lib/ai/settings";
import type { ProviderFieldSpec } from "@/lib/ai/types";
import type { ProviderUsage, RecentAiRun, DailyAiUsage } from "@/lib/ai/queries";
import {
  modelOptionsFor,
  AZURE_API_VERSIONS,
  CRON_PRESETS,
  OTHER_OPTION,
  type CatalogOption,
} from "@/lib/ai/catalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface ProviderProp {
  id: string;
  label: string;
  fields: ProviderFieldSpec;
  view: AiProviderSettingsView;
}

const labelCls = "text-sm font-medium";
const fieldCls = "flex flex-col gap-1.5";

function Notice({ state }: { state: AiSettingsActionState }) {
  if (state.error) {
    return (
      <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
        <AlertCircle className="size-4 shrink-0" />
        {state.error}
      </p>
    );
  }
  if (state.ok && state.message) {
    return (
      <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-4 shrink-0" />
        {state.message}
      </p>
    );
  }
  return null;
}

function fmtUsd(n: number): string {
  if (n === 0) return "$0.00";
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

/**
 * A <select> of curated options plus an "Other…" choice that reveals a free-text
 * input. Submits via a single field `name`: the chosen preset, or the typed
 * value when "Other" is active. If the saved value isn't a known option, it
 * starts in "Other" pre-filled — so existing custom values are preserved.
 */
function SelectWithOther({
  id,
  name,
  options,
  defaultValue,
  otherPlaceholder,
  className,
}: {
  id?: string;
  name: string;
  options: CatalogOption[];
  defaultValue: string;
  otherPlaceholder?: string;
  className?: string;
}) {
  const known = options.some((o) => o.value === defaultValue);
  const [choice, setChoice] = useState(
    defaultValue ? (known ? defaultValue : OTHER_OPTION) : "",
  );
  const [custom, setCustom] = useState(known ? "" : defaultValue || "");
  const selectCls =
    "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30" +
    (className ? " " + className : "");
  return (
    <>
      <select
        id={id}
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        className={selectCls}
      >
        <option value="" disabled>
          Select…
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        <option value={OTHER_OPTION}>Other… (type it in)</option>
      </select>
      {choice === OTHER_OPTION ? (
        <Input
          name={name}
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder={otherPlaceholder}
          autoComplete="off"
          className={className}
        />
      ) : (
        <input type="hidden" name={name} value={choice} />
      )}
    </>
  );
}

function ProviderCard({ provider }: { provider: ProviderProp }) {
  const { id, label, fields, view } = provider;
  const [enabled, setEnabled] = useState(view.enabled);
  const [saveState, saveAction, saving] = useActionState<AiSettingsActionState, FormData>(
    saveProviderAction,
    {},
  );
  const [testState, testAction, testing] = useActionState<AiSettingsActionState, FormData>(
    testProviderAction,
    {},
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            {label}
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            {view.hasKey ? (view.keyFromEnv ? "key from env" : "key set") : "no key"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form action={saveAction} className="flex flex-col gap-4">
          <input type="hidden" name="providerId" value={id} />

          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              name="enabled"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="size-4 rounded border-input accent-primary"
            />
            <span className={labelCls}>Enabled (include in analysis runs)</span>
          </label>

          <div className={fieldCls}>
            <label htmlFor={`${id}-model`} className={labelCls}>
              {fields.modelLabel}
            </label>
            <SelectWithOther
              id={`${id}-model`}
              name="model"
              options={modelOptionsFor(id)}
              defaultValue={view.model}
              otherPlaceholder={fields.modelPlaceholder}
            />
          </div>

          {fields.needsEndpoint && (
            <div className={fieldCls}>
              <label htmlFor={`${id}-endpoint`} className={labelCls}>
                Endpoint
              </label>
              <Input
                id={`${id}-endpoint`}
                name="endpoint"
                defaultValue={view.endpoint}
                placeholder="https://<resource>.openai.azure.com"
              />
            </div>
          )}

          {fields.needsApiVersion && (
            <div className={fieldCls}>
              <label htmlFor={`${id}-apiVersion`} className={labelCls}>
                API version
              </label>
              <SelectWithOther
                id={`${id}-apiVersion`}
                name="apiVersion"
                options={AZURE_API_VERSIONS}
                defaultValue={view.apiVersion}
                otherPlaceholder="2024-10-21"
              />
            </div>
          )}

          {fields.needsOrgProject && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className={fieldCls}>
                <label htmlFor={`${id}-org`} className={labelCls}>
                  Organization <span className="text-muted-foreground">(optional)</span>
                </label>
                <Input id={`${id}-org`} name="organization" defaultValue={view.organization} placeholder="org-…" />
              </div>
              <div className={fieldCls}>
                <label htmlFor={`${id}-project`} className={labelCls}>
                  Project <span className="text-muted-foreground">(optional)</span>
                </label>
                <Input id={`${id}-project`} name="project" defaultValue={view.project} placeholder="proj_…" />
              </div>
            </div>
          )}

          <div className={fieldCls}>
            <label htmlFor={`${id}-key`} className={labelCls}>
              API key
            </label>
            <Input
              id={`${id}-key`}
              name="newApiKey"
              type="password"
              autoComplete="off"
              placeholder={view.hasKey ? "•••••••• (leave blank to keep current)" : "Paste API key"}
            />
            {view.keyFromEnv && (
              <p className="text-xs text-muted-foreground">
                Currently using an environment variable. Saving a key here overrides it.
              </p>
            )}
            {view.hasKey && !view.keyFromEnv && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" name="clearApiKey" className="size-3.5 rounded border-input accent-primary" />
                Remove the stored key
              </label>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button type="submit" disabled={saving}>
              <KeyRound /> {saving ? "Saving…" : "Save"}
            </Button>
            <Notice state={saveState} />
          </div>
        </form>

        <form action={testAction} className="flex items-center gap-2 border-t pt-3">
          <input type="hidden" name="providerId" value={id} />
          <Button type="submit" variant="outline" disabled={testing}>
            <PlugZap /> {testing ? "Testing…" : "Test connection"}
          </Button>
          <Notice state={testState} />
        </form>
      </CardContent>
    </Card>
  );
}

function GlobalCard({ settings }: { settings: AiGlobalSettings }) {
  const [scheduleEnabled, setScheduleEnabled] = useState(settings.scheduleEnabled);
  const [state, action, saving] = useActionState<AiSettingsActionState, FormData>(
    saveAiSettingsAction,
    {},
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Schedule &amp; limits</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="section" value="schedule" />
          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              name="scheduleEnabled"
              checked={scheduleEnabled}
              onChange={(e) => setScheduleEnabled(e.target.checked)}
              className="size-4 rounded border-input accent-primary"
            />
            <span className={labelCls}>Run the daily analysis automatically</span>
          </label>

          <div className={fieldCls}>
            <label htmlFor="scheduleCron" className={labelCls}>
              Daily run schedule (cron, UTC)
            </label>
            <SelectWithOther
              id="scheduleCron"
              name="scheduleCron"
              options={CRON_PRESETS}
              defaultValue={settings.scheduleCron}
              otherPlaceholder="0 2 * * *"
              className="max-w-xs"
            />
            <p className="text-xs text-muted-foreground">
              Default <code>0 2 * * *</code> = 02:00 UTC (≈ end of the school day, US Pacific).
              The job wakes hourly and runs at the top of the next matching hour, so
              on-the-hour schedules fire exactly. Each run covers every district plus
              its schools (general + topology).
            </p>
          </div>

          <div className={fieldCls}>
            <label htmlFor="maxOutputTokens" className={labelCls}>
              Max output tokens per run
            </label>
            <Input
              id="maxOutputTokens"
              name="maxOutputTokens"
              type="number"
              min={256}
              defaultValue={settings.maxOutputTokens}
              className="max-w-xs"
            />
            <p className="text-xs text-muted-foreground">
              Azure OpenAI reserves this against the deployment&apos;s per-minute
              token (TPM) quota on every call, so smaller values trip 429s less.
              ~2048 is plenty for these reports; raise it only if output looks cut off.
            </p>
          </div>

          <div className={fieldCls}>
            <label htmlFor="monthlySpendCapUsd" className={labelCls}>
              Monthly spend target ($, advisory)
            </label>
            <Input
              id="monthlySpendCapUsd"
              name="monthlySpendCapUsd"
              type="number"
              min={0}
              step="0.01"
              defaultValue={settings.monthlySpendCapUsd ?? ""}
              placeholder="e.g. 50"
              className="max-w-xs"
            />
            <p className="text-xs text-muted-foreground">
              Shown against tracked usage below. Not enforced yet — runs are never blocked.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save settings"}
            </Button>
            <Notice state={state} />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function AssistantCard({ settings }: { settings: AiGlobalSettings }) {
  const [state, action, saving] = useActionState<AiSettingsActionState, FormData>(
    saveAiSettingsAction,
    {},
  );
  const [avatarState, uploadAvatar, uploadingAvatar] = useActionState<
    AiSettingsActionState,
    FormData
  >(uploadAssistantAvatarAction, {});
  const [clearAvatarState, clearAvatar, clearingAvatar] = useActionState<
    AiSettingsActionState,
    FormData
  >(clearAssistantAvatarAction, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-primary" /> Assistant (in-app chatbot)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="section" value="assistant" />

          <div className={fieldCls}>
            <label htmlFor="assistantName" className={labelCls}>
              Assistant name
            </label>
            <Input
              id="assistantName"
              name="assistantName"
              defaultValue={settings.assistantName ?? ""}
              placeholder="NetMon Assistant"
              maxLength={80}
              className="max-w-xs"
            />
          </div>

          <div className={fieldCls}>
            <label htmlFor="assistantGreeting" className={labelCls}>
              Greeting
            </label>
            <textarea
              id="assistantGreeting"
              name="assistantGreeting"
              rows={3}
              maxLength={500}
              defaultValue={settings.assistantGreeting ?? ""}
              placeholder="Shown when a chat is empty. e.g. “Hi! I'm the NetMon Assistant. Ask me about the network, a device, or how the dashboard works.”"
              className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              The opening message users see before they ask anything. Blank uses the built-in text.
            </p>
          </div>

          <div className={fieldCls}>
            <label htmlFor="assistantInstructions" className={labelCls}>
              Assistant instructions
            </label>
            <textarea
              id="assistantInstructions"
              name="assistantInstructions"
              rows={5}
              defaultValue={settings.assistantInstructions ?? ""}
              placeholder="Leave blank for the built-in default. e.g. “You are NetMon Assistant, a senior network engineer helping K-12 district IT. Be concise and practical…”"
              className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              The in-app chatbot&apos;s persona + behavior. Blank uses the built-in default.
              The app-knowledge primer and anti-hallucination grounding are always applied and
              can&apos;t be removed here.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save assistant"}
            </Button>
            <Notice state={state} />
          </div>
        </form>

        <div className="mt-4 flex flex-col gap-2 border-t pt-4">
          <span className={labelCls}>Assistant picture</span>
          <div className="flex flex-wrap items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/ai/avatar"
              alt=""
              className="size-12 rounded-lg border object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
              }}
            />
            <form action={uploadAvatar} className="flex items-center gap-2">
              <input
                type="file"
                name="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                className="max-w-[12rem] text-xs file:mr-2 file:rounded file:border file:bg-muted file:px-2 file:py-1"
              />
              <Button type="submit" size="sm" variant="outline" disabled={uploadingAvatar}>
                {uploadingAvatar ? "Uploading…" : "Upload"}
              </Button>
            </form>
            <form action={clearAvatar}>
              <Button type="submit" size="sm" variant="ghost" disabled={clearingAvatar}>
                Remove
              </Button>
            </form>
          </div>
          <Notice state={avatarState} />
          <Notice state={clearAvatarState} />
          <p className="text-xs text-muted-foreground">
            PNG/JPEG/WEBP/GIF/SVG, max 512 KB. Appears on the floating chat button.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function UsageCard({
  usage,
  providers,
  cap,
}: {
  usage: ProviderUsage[];
  providers: ProviderProp[];
  cap: number | null;
}) {
  const labelFor = (id: string) => providers.find((p) => p.id === id)?.label ?? id;
  const totalCost = usage.reduce((a, u) => a + u.costUsd, 0);
  const totalRuns = usage.reduce((a, u) => a + u.runs, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="size-4 text-primary" /> Usage this month
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {usage.length === 0 ? (
          <p className="text-muted-foreground">No analysis runs yet this month.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pr-4 font-medium">Model</th>
                  <th className="py-1 pr-4 font-medium">Runs</th>
                  <th className="py-1 pr-4 font-medium">Failed</th>
                  <th className="py-1 pr-4 font-medium">Tokens in/out</th>
                  <th className="py-1 font-medium">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {usage.map((u) => (
                  <tr key={u.providerId} className="border-t">
                    <td className="py-1.5 pr-4">{labelFor(u.providerId)}</td>
                    <td className="py-1.5 pr-4">{u.runs}</td>
                    <td className="py-1.5 pr-4">{u.failed > 0 ? u.failed : "—"}</td>
                    <td className="py-1.5 pr-4 tabular-nums">
                      {u.tokensIn.toLocaleString()} / {u.tokensOut.toLocaleString()}
                    </td>
                    <td className="py-1.5 tabular-nums">{fmtUsd(u.costUsd)}</td>
                  </tr>
                ))}
                <tr className="border-t font-medium">
                  <td className="py-1.5 pr-4">Total</td>
                  <td className="py-1.5 pr-4">{totalRuns}</td>
                  <td className="py-1.5 pr-4" />
                  <td className="py-1.5 pr-4" />
                  <td className="py-1.5 tabular-nums">{fmtUsd(totalCost)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {cap != null
            ? `Advisory monthly target: ${fmtUsd(cap)} — ${
                totalCost > cap ? "over" : "within"
              } target. `
            : ""}
          Costs are estimates from token counts × approximate model prices (see pricing.ts).
        </p>
      </CardContent>
    </Card>
  );
}

function fmtTokens(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

function ActivityCard({
  runs,
  daily,
}: {
  runs: RecentAiRun[];
  daily: DailyAiUsage[];
}) {
  // Fill the last 14 days so the timeline axis stays continuous even with gaps.
  const DAYS = 14;
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const today = new Date();
  const series: DailyAiUsage[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const dt = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
      dt.getDate(),
    ).padStart(2, "0")}`;
    series.push(byDay.get(key) ?? { day: key, runs: 0, failed: 0, tokens: 0, costUsd: 0 });
  }
  const maxTokens = Math.max(1, ...series.map((d) => d.tokens));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="size-4 text-primary" /> AI activity
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 text-sm">
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Tokens / day · last 14 days
          </p>
          <div className="flex h-24 items-end gap-1">
            {series.map((d) => {
              const h = Math.round((d.tokens / maxTokens) * 100);
              return (
                <div
                  key={d.day}
                  className="flex flex-1 flex-col justify-end"
                  title={`${d.day}: ${d.tokens.toLocaleString()} tokens · ${d.runs} run(s)${
                    d.failed > 0 ? ` · ${d.failed} failed` : ""
                  }`}
                >
                  <div
                    className={`w-full rounded-t ${d.failed > 0 ? "bg-destructive/70" : "bg-primary/70"}`}
                    style={{ height: `${d.tokens > 0 ? Math.max(4, h) : 0}%` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{series[0].day.slice(5)}</span>
            <span>today</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Recent runs
          </p>
          {runs.length === 0 ? (
            <p className="text-muted-foreground">No runs recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3 font-medium">When</th>
                    <th className="py-1 pr-3 font-medium">Trigger</th>
                    <th className="py-1 pr-3 font-medium">Kind</th>
                    <th className="py-1 pr-3 font-medium">Scope</th>
                    <th className="py-1 pr-3 font-medium">Model</th>
                    <th className="py-1 pr-3 font-medium">Tok in/out</th>
                    <th className="py-1 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-t align-top">
                      <td className="whitespace-nowrap py-1.5 pr-3">{relativeTime(r.createdAt)}</td>
                      <td className="py-1.5 pr-3">{r.trigger}</td>
                      <td className="py-1.5 pr-3">{r.kind}</td>
                      <td className="py-1.5 pr-3">{r.scopeLabel}</td>
                      <td className="whitespace-nowrap py-1.5 pr-3">{r.model ?? r.providerId}</td>
                      <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums">
                        {fmtTokens(r.tokensIn)}/{fmtTokens(r.tokensOut)}
                      </td>
                      <td className="py-1.5">
                        {r.status === "ok" ? (
                          <span className="text-emerald-600 dark:text-emerald-400">ok</span>
                        ) : r.status === "running" ? (
                          <span className="text-muted-foreground">running…</span>
                        ) : (
                          <span className="text-destructive" title={r.error ?? ""}>
                            {r.error?.includes("429") ? "rate-limited (429)" : "failed"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function AiSettingsForm({
  providers,
  settings,
  usage,
  recentRuns,
  dailyUsage,
}: {
  providers: ProviderProp[];
  settings: AiGlobalSettings;
  usage: ProviderUsage[];
  recentRuns: RecentAiRun[];
  dailyUsage: DailyAiUsage[];
}) {
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="grid gap-4">
        {providers.map((p) => (
          <ProviderCard key={p.id} provider={p} />
        ))}
      </div>
      {/* Remount GlobalCard whenever settings change (updatedAt bumps on every
          save) so its checkbox state re-syncs to the persisted value instead of
          shadowing it in stale local state. */}
      <GlobalCard
        key={String(settings.updatedAt ?? settings.scheduleEnabled)}
        settings={settings}
      />
      <AssistantCard
        key={"assistant-" + String(settings.updatedAt ?? "")}
        settings={settings}
      />
      <ActivityCard runs={recentRuns} daily={dailyUsage} />
      <UsageCard usage={usage} providers={providers} cap={settings.monthlySpendCapUsd} />
    </div>
  );
}
