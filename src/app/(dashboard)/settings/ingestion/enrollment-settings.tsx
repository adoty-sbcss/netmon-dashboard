"use client";

import { useActionState, useState } from "react";
import { AlertCircle, CheckCircle2, KeyRound } from "lucide-react";

import {
  saveEnrollmentAction,
  type EnrollmentActionState,
} from "@/lib/sensor/enrollment-actions";
import type { EnrollmentView } from "@/lib/sensor/enrollment";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/section-header";

export interface SftpProvision {
  host: string;
  port: number;
  user: string;
  /** null when the drop uses key auth (sensors need a password) or none set. */
  password: string | null;
  remotePath: string;
}

export function EnrollmentSettings({
  enrollment,
  appOrigin,
  sftp,
}: {
  enrollment: EnrollmentView;
  appOrigin: string;
  sftp: SftpProvision | null;
}) {
  const [state, action, saving] = useActionState<EnrollmentActionState, FormData>(
    saveEnrollmentAction,
    {},
  );
  const [enabled, setEnabled] = useState(enrollment.autoEnrollEnabled);
  const labelCls = "text-sm font-medium";

  // The full contents of config/provisioning.env: dashboard URL + bootstrap key,
  // plus the shared SFTP drop creds when configured. Host/port/user/password and
  // the base path are identical fleet-wide; the box appends
  // /<district>/<school>/<device> from its identity slugs automatically.
  const provisionLines = [
    `NETMON_DASHBOARD_URL=${appOrigin}`,
    `NETMON_BOOTSTRAP_KEY=${enrollment.bootstrapKey ?? ""}`,
  ];
  if (sftp) {
    provisionLines.push(
      `NETMON_SFTP_HOST=${sftp.host}`,
      `NETMON_SFTP_PORT=${sftp.port}`,
      `NETMON_SFTP_USER=${sftp.user}`,
    );
    if (sftp.password) provisionLines.push(`NETMON_SFTP_PASSWORD=${sftp.password}`);
    provisionLines.push(`NETMON_SFTP_REMOTE_PATH=${sftp.remotePath || "/"}`);
  }
  const provisionEnv = provisionLines.join("\n");
  const sftpNeedsPassword = !!sftp && !sftp.password;

  return (
    <Card>
      <SectionHeader icon={KeyRound} title="Sensor auto-enrollment" />
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Put one shared <strong>bootstrap key</strong> on every new box (same key
            everywhere). On its first check-in the box self-registers and is issued
            its own token automatically — no per-sensor token copying.
          </p>

          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="mb-2 text-sm font-medium">How sensor enrollment works</p>
            <ol className="ml-4 list-decimal space-y-1.5 text-sm text-muted-foreground">
              <li>
                Turn on auto-enrollment below and set <strong>one</strong> shared
                bootstrap key. The same key is used by every sensor in your fleet.
              </li>
              <li>
                On each new box, the dashboard URL, bootstrap key, and SFTP
                upload credentials are pre-filled from a small{" "}
                <code>config/provisioning.env</code> file (snippet below). The
                on-site technician enters only the <strong>site identity</strong>{" "}
                — district / school / device — and presses Enter to accept
                everything else.
              </li>
              <li>
                On its first check-in the box presents the bootstrap key plus its
                identity. The dashboard verifies the key, creates the sensor, and
                issues it a unique per-sensor token that the box stores. Nobody
                copies a token by hand.
              </li>
              <li>
                From then on the box checks in over <strong>outbound HTTPS only</strong>{" "}
                (it opens no inbound ports). It appears under{" "}
                <strong>Sensors</strong>, where you can watch it, push config
                (SNMP, scan cadence, SFTP), and run commands.
              </li>
            </ol>
            <p className="mt-3 text-xs text-muted-foreground">
              Turning auto-enrollment <strong>off</strong> immediately stops new
              boxes from registering. Already-enrolled sensors keep working with
              the tokens they were issued.
            </p>
          </div>

          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              name="autoEnrollEnabled"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="size-4 rounded border-input accent-primary"
            />
            <span className={labelCls}>Allow boxes to self-enroll with the bootstrap key</span>
          </label>

          {enrollment.bootstrapKey ? (
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className={labelCls}>Current bootstrap key</p>
              <code className="mt-1 block break-all rounded bg-background px-2 py-1.5 font-mono text-xs select-all">
                {enrollment.bootstrapKey}
              </code>

              <p className="mt-3 text-xs text-muted-foreground">
                <strong>Provision new boxes</strong> — save this as{" "}
                <code>config/provisioning.env</code> in the cloned repo on each
                box (or place it at <code>/etc/netmon/provisioning.env</code>).
                The setup wizard pre-fills these values so the technician just
                presses Enter:
              </p>
              <pre className="mt-1 overflow-x-auto rounded bg-background px-2 py-1.5 text-[11px] leading-relaxed select-all">
{provisionEnv}
              </pre>

              {sftp ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  SFTP credentials are the same ones this dashboard uses to pull
                  bundles (Settings → SFTP ingestion). The box appends{" "}
                  <code>/&lt;district&gt;/&lt;school&gt;/&lt;device&gt;</code> to
                  the path automatically from its identity.
                </p>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  Configure <strong>SFTP ingestion</strong> above to also bake the
                  upload credentials into this snippet.
                </p>
              )}
              {sftpNeedsPassword && (
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-500">
                  Your SFTP drop uses key authentication. Sensors upload with a
                  password, so add a <code>NETMON_SFTP_PASSWORD=…</code> line
                  manually (or switch the ingestion settings to password auth).
                </p>
              )}

              <p className="mt-3 text-xs text-muted-foreground">
                <strong>One-time install</strong> on a fresh Ubuntu box:
              </p>
              <pre className="mt-1 overflow-x-auto rounded bg-background px-2 py-1.5 text-[11px] leading-relaxed select-all">
{`git clone https://github.com/adoty-sbcss/net_mon.git
cd net_mon
cat > config/provisioning.env <<'EOF'
${provisionEnv}
EOF
sudo ./setup.sh`}
              </pre>
              <p className="mt-2 text-xs text-muted-foreground">
                During setup the tech enters only district / school / device.
                The box enrolls on its first check-in and shows up under{" "}
                <strong>Sensors</strong> within a few minutes.
              </p>

              <p className="mt-3 text-xs text-amber-600 dark:text-amber-500">
                The bootstrap key and SFTP password are shared secrets. The
                collector repo is public — never commit{" "}
                <code>config/provisioning.env</code> (it is git-ignored).
                Distribute it out-of-band and rotate the key below if it leaks.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No bootstrap key yet — generate one below.
            </p>
          )}

          <label className="flex items-center gap-2.5">
            <input type="checkbox" name="generate" className="size-4 rounded border-input accent-primary" />
            <span className="text-sm">
              {enrollment.bootstrapKey ? "Generate a new key (rotates — old boxes must update)" : "Generate a key"}
            </span>
          </label>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="newBootstrapKey" className={labelCls}>…or set a custom key</label>
            <Input
              id="newBootstrapKey"
              name="newBootstrapKey"
              placeholder="leave blank to keep the current key"
              autoComplete="off"
              className="max-w-md"
            />
          </div>

          {state.error && (
            <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
              <AlertCircle className="size-4 shrink-0" /> {state.error}
            </p>
          )}
          {state.ok && state.message && (
            <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-4 shrink-0" /> {state.message}
            </p>
          )}

          <div>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
