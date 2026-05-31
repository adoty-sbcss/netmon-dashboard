"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, AlertCircle, PlugZap, RefreshCw } from "lucide-react";

import {
  saveSettingsAction,
  testConnectionAction,
  syncNowAction,
  type SettingsActionState,
} from "@/lib/ingest/actions";
import type { IngestSettingsView } from "@/lib/ingest/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function Notice({ state }: { state: SettingsActionState }) {
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
  if (state.message) {
    return <p className="text-sm text-muted-foreground">{state.message}</p>;
  }
  return null;
}

export function IngestionSettingsForm({
  settings,
}: {
  settings: IngestSettingsView;
}) {
  const [authMode, setAuthMode] = useState<"password" | "key">(settings.authMode);

  const [saveState, saveAction, saving] = useActionState<SettingsActionState, FormData>(
    saveSettingsAction,
    {},
  );
  const [testState, testAction, testing] = useActionState<SettingsActionState, FormData>(
    testConnectionAction,
    {},
  );
  const [syncState, syncAction, syncing] = useActionState<SettingsActionState, FormData>(
    syncNowAction,
    {},
  );

  const labelCls = "text-sm font-medium";
  const fieldCls = "flex flex-col gap-1.5";

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {/* ---- Connection settings ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Connection</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={saveAction} className="flex flex-col gap-4">
            <label className="flex items-center gap-2.5">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={settings.enabled}
                className="size-4 rounded border-input accent-primary"
              />
              <span className={labelCls}>Enable scheduled & on-demand ingestion</span>
            </label>

            <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
              <div className={fieldCls}>
                <label htmlFor="host" className={labelCls}>
                  SFTP host
                </label>
                <Input
                  id="host"
                  name="host"
                  defaultValue={settings.host}
                  placeholder="sftp.example.org"
                  autoComplete="off"
                />
              </div>
              <div className={fieldCls}>
                <label htmlFor="port" className={labelCls}>
                  Port
                </label>
                <Input
                  id="port"
                  name="port"
                  type="number"
                  min={1}
                  max={65535}
                  defaultValue={settings.port}
                />
              </div>
            </div>

            <div className={fieldCls}>
              <label htmlFor="username" className={labelCls}>
                Username
              </label>
              <Input
                id="username"
                name="username"
                defaultValue={settings.username}
                placeholder="netmon"
                autoComplete="off"
              />
            </div>

            <div className={fieldCls}>
              <label htmlFor="authMode" className={labelCls}>
                Authentication
              </label>
              <select
                id="authMode"
                name="authMode"
                value={authMode}
                onChange={(e) => setAuthMode(e.target.value as "password" | "key")}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              >
                <option value="password">Password</option>
                <option value="key">SSH private key</option>
              </select>
            </div>

            {authMode === "password" ? (
              <div className={fieldCls}>
                <label htmlFor="newPassword" className={labelCls}>
                  Password
                </label>
                <Input
                  id="newPassword"
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  placeholder={
                    settings.hasPassword ? "•••••••• (unchanged)" : "Enter password"
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {settings.hasPassword
                    ? "A password is stored. Leave blank to keep it; type a new one to replace it."
                    : "Stored encrypted at rest."}
                </p>
              </div>
            ) : (
              <>
                <div className={fieldCls}>
                  <label htmlFor="newPrivateKey" className={labelCls}>
                    Private key (PEM)
                  </label>
                  <textarea
                    id="newPrivateKey"
                    name="newPrivateKey"
                    rows={5}
                    autoComplete="off"
                    placeholder={
                      settings.hasPrivateKey
                        ? "Key on file — leave blank to keep it, or paste a new one"
                        : "-----BEGIN OPENSSH PRIVATE KEY-----"
                    }
                    className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                  />
                </div>
                <div className={fieldCls}>
                  <label htmlFor="newPassphrase" className={labelCls}>
                    Key passphrase (optional)
                  </label>
                  <Input
                    id="newPassphrase"
                    name="newPassphrase"
                    type="password"
                    autoComplete="new-password"
                    placeholder={
                      settings.hasPassphrase ? "•••••••• (unchanged)" : "If the key is encrypted"
                    }
                  />
                  {settings.hasPassphrase && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input type="checkbox" name="clearPassphrase" className="size-3.5 accent-primary" />
                      Remove the stored passphrase
                    </label>
                  )}
                </div>
              </>
            )}

            <div className={fieldCls}>
              <label htmlFor="baseDir" className={labelCls}>
                Remote base directory
              </label>
              <Input id="baseDir" name="baseDir" defaultValue={settings.baseDir} placeholder="/" />
              <p className="text-xs text-muted-foreground">
                The folder tree to walk for bundle ZIPs (recursive).
              </p>
            </div>

            <Notice state={saveState} />

            <div>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save settings"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* ---- Actions: test + sync ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Pull data</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <form action={testAction}>
              <Button type="submit" variant="outline" disabled={testing}>
                <PlugZap className="size-4" />
                {testing ? "Testing…" : "Test connection"}
              </Button>
            </form>
            <form action={syncAction}>
              <Button type="submit" disabled={syncing}>
                <RefreshCw className={syncing ? "size-4 animate-spin" : "size-4"} />
                {syncing ? "Syncing…" : "Sync now"}
              </Button>
            </form>
          </div>

          <Notice state={testState} />
          <Notice state={syncState} />

          {syncState.log && syncState.log.length > 0 && (
            <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-3 text-xs leading-relaxed">
              {syncState.log.join("\n")}
            </pre>
          )}

          <div className="border-t pt-3 text-xs text-muted-foreground">
            <p>
              Last run:{" "}
              {settings.lastSyncAt ? (
                <>
                  <span className="font-medium text-foreground">
                    {new Date(settings.lastSyncAt).toLocaleString()}
                  </span>
                  {settings.lastSyncStatus && ` — ${settings.lastSyncStatus}`}
                </>
              ) : (
                "never"
              )}
            </p>
            {settings.lastSyncSummary && (
              <p className="mt-0.5 font-mono">{settings.lastSyncSummary}</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
