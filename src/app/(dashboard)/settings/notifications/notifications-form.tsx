"use client";

import { useActionState } from "react";
import {
  AlertCircle,
  Bell,
  CheckCircle2,
  FileText,
  Mail,
  Send,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  saveNotificationSettingsAction,
  addRecipientAction,
  updateRecipientAction,
  removeRecipientAction,
  sendTestEmailAction,
  type NotifActionState,
} from "@/lib/notifications/actions";
import type { NotifConfig, Recipient } from "@/lib/notifications/settings";

const labelCls = "text-sm font-medium";
const selectCls =
  "h-9 max-w-[14rem] rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/50";

function Notice({ state }: { state: NotifActionState }) {
  if (state.error)
    return (
      <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
        <AlertCircle className="size-4 shrink-0" /> {state.error}
      </p>
    );
  if (state.ok && state.message)
    return (
      <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-4 shrink-0" /> {state.message}
      </p>
    );
  return null;
}

function Check({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex items-center gap-2.5">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="size-4 rounded border-input accent-primary"
      />
      <span className={labelCls}>{label}</span>
    </label>
  );
}

export function NotificationsForm({
  config,
  recipients,
  emailConfigured,
}: {
  config: NotifConfig;
  recipients: Recipient[];
  emailConfigured: boolean;
}) {
  const [cfgState, cfgAction, savingCfg] = useActionState<NotifActionState, FormData>(
    saveNotificationSettingsAction,
    {},
  );
  const [addState, addAction, adding] = useActionState<NotifActionState, FormData>(
    addRecipientAction,
    {},
  );
  const [testState, testAction, testing] = useActionState<NotifActionState, FormData>(
    sendTestEmailAction,
    {},
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Email transport status + send test */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="size-4 text-primary" /> Email delivery
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {emailConfigured ? (
              <Badge variant="outline" className="border-[var(--success)] text-[var(--success)]">
                connected (Azure Communication Services)
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                not wired in this environment
              </Badge>
            )}
            <span className="text-muted-foreground">
              {emailConfigured
                ? "Outbound email is live."
                : "Sends are logged until ACS_CONNECTION_STRING is set."}
            </span>
          </div>
          <Notice state={testState} />
          <form action={testAction} className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="testTo" className="text-xs text-muted-foreground">
                Send a test email to
              </label>
              <Input
                id="testTo"
                name="to"
                type="email"
                placeholder="you@sbcss.net"
                autoComplete="off"
                className="w-64"
              />
            </div>
            <Button type="submit" variant="outline" disabled={testing}>
              <Send className={testing ? "size-4 animate-pulse" : "size-4"} />
              {testing ? "Sending…" : "Send test"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Report + alert settings (one save) */}
      <form action={cfgAction}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="size-4 text-primary" /> Monthly summary
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Check
              name="reportEnabled"
              label="Send the monthly administrative summary"
              defaultChecked={config.reportEnabled}
            />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="reportDay" className={labelCls}>
                Send on day of month
              </label>
              <select
                id="reportDay"
                name="reportDayOfMonth"
                defaultValue={String(config.reportDayOfMonth)}
                className={selectCls}
              >
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Covers Azure spend, AI usage, site access, and major issues per district.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bell className="size-4 text-primary" /> Alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Check
              name="alertsEnabled"
              label="Send alert emails"
              defaultChecked={config.alertsEnabled}
            />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="minSev" className={labelCls}>
                Minimum severity to alert on
              </label>
              <select
                id="minSev"
                name="alertMinSeverity"
                defaultValue={config.alertMinSeverity}
                className={selectCls}
              >
                <option value="critical">Critical only</option>
                <option value="high">High and above</option>
                <option value="medium">Medium and above</option>
              </select>
            </div>
            <div className="flex flex-col gap-2.5">
              <Check
                name="alertOnSecurity"
                label="Security findings"
                defaultChecked={config.alertOnSecurity}
              />
              <Check
                name="alertOnSensorOffline"
                label="Sensor offline"
                defaultChecked={config.alertOnSensorOffline}
              />
              <Check
                name="alertOnStorage"
                label="Database storage high"
                defaultChecked={config.alertOnStorage}
              />
            </div>

            <div className="flex flex-col gap-1.5 border-t pt-4">
              <label htmlFor="fromOverride" className={labelCls}>
                Sender address override (optional)
              </label>
              <Input
                id="fromOverride"
                name="fromOverride"
                type="email"
                defaultValue={config.fromOverride ?? ""}
                placeholder="netmon@sbcss.net (after verifying a branded domain)"
                autoComplete="off"
                className="max-w-md"
              />
            </div>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={savingCfg}>
                {savingCfg ? "Saving…" : "Save settings"}
              </Button>
              <Notice state={cfgState} />
            </div>
          </CardContent>
        </Card>
      </form>

      {/* Recipients */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recipients</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {recipients.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No recipients yet — add one below. Alerts and the monthly summary go to whoever is
              subscribed to each.
            </p>
          ) : (
            <ul className="divide-y">
              {recipients.map((r) => (
                <RecipientRow key={r.id} recipient={r} />
              ))}
            </ul>
          )}

          <form action={addAction} className="flex flex-col gap-3 border-t pt-4">
            <p className={labelCls}>Add a recipient</p>
            <Notice state={addState} />
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="email" className="text-xs text-muted-foreground">
                  Email
                </label>
                <Input id="email" name="email" type="email" placeholder="name@sbcss.net" className="w-64" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="name" className="text-xs text-muted-foreground">
                  Name (optional)
                </label>
                <Input id="name" name="name" placeholder="Jane Admin" className="w-48" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-5">
              <Check name="alerts" label="Alerts" defaultChecked />
              <Check name="reports" label="Monthly summary" defaultChecked />
              <Button type="submit" variant="outline" disabled={adding}>
                {adding ? "Adding…" : "Add recipient"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function RecipientRow({ recipient }: { recipient: Recipient }) {
  const [upState, upAction, saving] = useActionState<NotifActionState, FormData>(
    updateRecipientAction,
    {},
  );
  const [, rmAction, removing] = useActionState<NotifActionState, FormData>(
    removeRecipientAction,
    {},
  );

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{recipient.email}</p>
        {recipient.name && (
          <p className="truncate text-xs text-muted-foreground">{recipient.name}</p>
        )}
      </div>
      <form action={upAction} className="flex items-center gap-4">
        <input type="hidden" name="id" value={recipient.id} />
        <Check name="alerts" label="Alerts" defaultChecked={recipient.alerts} />
        <Check name="reports" label="Summary" defaultChecked={recipient.reports} />
        <Button type="submit" variant="ghost" size="sm" disabled={saving}>
          {saving ? "…" : "Save"}
        </Button>
        {upState.error && <AlertCircle className="size-4 text-destructive" />}
        {upState.ok && <CheckCircle2 className="size-4 text-emerald-500" />}
      </form>
      <form action={rmAction}>
        <input type="hidden" name="id" value={recipient.id} />
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          disabled={removing}
          className="text-destructive hover:text-destructive"
          aria-label={`Remove ${recipient.email}`}
        >
          <Trash2 className="size-4" />
        </Button>
      </form>
    </li>
  );
}
