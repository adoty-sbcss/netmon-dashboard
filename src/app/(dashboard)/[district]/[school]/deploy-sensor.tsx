"use client";

/**
 * PROV-2b: "Deploy a sensor here" — generates the provisioning file + install
 * commands for THIS district/school landing spot. The tech opens this page on a
 * fresh Ubuntu box (authenticated), names the sensor, copies the two blocks, and
 * runs install.sh; the box auto-enrolls into <district>/<school>/<device>.
 *
 * Superadmin-gated by the page: the provisioning block carries the bootstrap key
 * + SFTP password, so it must not be shown to ordinary district viewers.
 */
import { useState } from "react";
import { Rocket, Copy, Check, TriangleAlert } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const REPO_URL = "https://github.com/adoty-sbcss/net_mon.git";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export interface DeploySftp {
  host: string;
  port: number;
  user: string;
  password: string | null;
  remotePath: string;
}

export function DeploySensor({
  appOrigin,
  bootstrapKey,
  sftp,
  districtName,
  districtSlug,
  schoolName,
  schoolSlug,
}: {
  appOrigin: string;
  bootstrapKey: string | null;
  sftp: DeploySftp | null;
  districtName: string;
  districtSlug: string;
  schoolName: string;
  schoolSlug: string;
}) {
  const [device, setDevice] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const deviceSlug = device.trim() ? slugify(device) : "";
  const deviceName = device.trim() || "MAIN IDF";
  const effectiveSlug = deviceSlug || "main-idf";

  const provLines = [
    `NETMON_DASHBOARD_URL=${appOrigin}`,
    `NETMON_BOOTSTRAP_KEY=${bootstrapKey ?? ""}`,
    `NETMON_DISTRICT=${districtName}`,
    `NETMON_DISTRICT_SLUG=${districtSlug}`,
    `NETMON_SCHOOL=${schoolName}`,
    `NETMON_SCHOOL_SLUG=${schoolSlug}`,
    `NETMON_DEVICE=${deviceName}`,
    `NETMON_DEVICE_SLUG=${effectiveSlug}`,
  ];
  if (sftp) {
    provLines.push(
      `NETMON_SFTP_HOST=${sftp.host}`,
      `NETMON_SFTP_PORT=${sftp.port}`,
      `NETMON_SFTP_USER=${sftp.user}`,
    );
    if (sftp.password) provLines.push(`NETMON_SFTP_PASSWORD=${sftp.password}`);
    provLines.push(`NETMON_SFTP_REMOTE_PATH=${sftp.remotePath || "/"}`);
  }
  const provEnv = provLines.join("\n");

  const installCmds = `git clone ${REPO_URL} NetMon && cd NetMon
# save the provisioning block (below) to config/provisioning.env, then:
sudo ./install.sh`;

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const CopyBtn = ({ text, k }: { text: string; k: string }) => (
    <Button type="button" variant="outline" size="sm" onClick={() => copy(text, k)}>
      {copied === k ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied === k ? "Copied" : "Copy"}
    </Button>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Rocket className="size-4 text-primary" />
          Deploy a sensor here
          <span className="text-xs font-normal text-muted-foreground">
            {districtSlug}/{schoolSlug}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">
          On a fresh Ubuntu box for this site, run the steps below. The box installs
          itself, runs a hardening check, and auto-enrolls into{" "}
          <span className="font-mono text-xs">
            {districtSlug}/{schoolSlug}/{effectiveSlug}
          </span>{" "}
          on its first check-in.
        </p>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">
            1. Name this sensor (its location at the site)
          </label>
          <Input
            value={device}
            onChange={(e) => setDevice(e.target.value)}
            placeholder="MAIN IDF"
            className="h-9 w-64"
          />
          <p className="text-xs text-muted-foreground">
            slug: <span className="font-mono">{effectiveSlug}</span>
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">2. Install commands</label>
            <CopyBtn text={installCmds} k="cmds" />
          </div>
          <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-2 font-mono text-xs">{installCmds}</pre>
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">
              3. Save as <span className="font-mono">config/provisioning.env</span>
            </label>
            <CopyBtn text={provEnv} k="prov" />
          </div>
          <pre className="max-h-48 overflow-auto rounded-lg border bg-zinc-950 p-2 font-mono text-xs text-zinc-100">{provEnv}</pre>
          <p className="flex items-start gap-1.5 text-xs text-amber-600">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            Contains the enrollment key{sftp?.password ? " + SFTP password" : ""} — treat it like a
            credential. It’s git-ignored on the box.
          </p>
        </div>

        {!bootstrapKey && (
          <p className="text-xs text-destructive">
            No auto-enrollment key set. Turn it on in Settings → Ingestion first, or the box can’t self-enroll.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
