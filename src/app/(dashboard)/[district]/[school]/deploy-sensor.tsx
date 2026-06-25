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
import { Rocket, Copy, Check, TriangleAlert, Download } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/section-header";

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
  // CIS hardening: on by default (applies the NetMon-vetted safe subset at install).
  const [cisHarden, setCisHarden] = useState(true);
  // Optional VLAN trunk monitoring (802.1Q sub-interfaces set up at install time).
  const [vlanIds, setVlanIds] = useState("");
  const [vlanParent, setVlanParent] = useState("");
  const [vlanStatics, setVlanStatics] = useState("");

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
    // --- Recommended defaults for a fresh box (enabled out of the box; all are
    // changeable later from the dashboard settings). The collector ships these
    // OFF by default, so baking them in here is what makes a new sensor actually
    // crawl topology + run speed tests without a tech remembering to flip them.
    // SNMP spine crawl: needs a community to do anything; "public" is a benign
    // read-only starting point — set the district's real community in settings.
    `NETMON_SNMP_ENABLED=true`,
    `NETMON_SNMP_COMMUNITIES=public`,
    `NETMON_SNMP_TOPOLOGY_ENABLED=true`,
    `NETMON_SNMP_TOPOLOGY_SCOPE=spine`,
    // Public internet speed test (Cloudflare — dependency-free, reliable on
    // filtered school networks; Ookla was removed).
    `NETMON_SPEEDTEST_ENABLED=true`,
    `NETMON_SPEEDTEST_PROVIDERS=cloudflare`,
    // CIS hardening: install.sh applies the NetMon-vetted safe subset (SSH left
    // untouched; reversible) — see docs/HARDENING.md.
    `NETMON_CIS_HARDEN=${cisHarden ? "true" : "false"}`,
  ];
  // VLAN trunk monitoring (optional): install.sh creates 802.1Q sub-interfaces
  // (routes-off) so the collector scans these VLANs. Only emitted when set.
  const vlanClean = vlanIds.replace(/[^0-9,]/g, "").replace(/,+/g, ",").replace(/^,|,$/g, "");
  if (vlanClean) {
    provLines.push(`NETMON_TRUNK_VLANS=${vlanClean}`);
    if (vlanParent.trim()) provLines.push(`NETMON_TRUNK_PARENT=${vlanParent.trim()}`);
    if (vlanStatics.trim()) provLines.push(`NETMON_TRUNK_STATICS=${vlanStatics.trim()}`);
  }
  if (sftp) {
    provLines.push(
      // Without this the box gets valid creds but uploads stay OFF (the flag
      // defaults to false), so `upload-test` passes while real uploads no-op
      // with "SFTP disabled". Mirrors the wizard (lib/sftp.sh sets it true too).
      `NETMON_SFTP_ENABLED=true`,
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

  // Self-contained, ready-to-run installer with this site's config baked in —
  // the tech downloads ONE file and runs it; nothing to edit. It clones the
  // collector, writes config/provisioning.env itself, and runs install.sh.
  const fileName = `netmon-install-${schoolSlug}.sh`;
  const installerScript = `#!/usr/bin/env bash
# NetMon sensor installer — ${districtName} / ${schoolName} / ${deviceName}
# Generated by the NetMon dashboard. On a fresh Ubuntu box, run:
#     sudo bash ${fileName}
# It installs everything and enrolls this box into the site. Nothing to edit.
set -euo pipefail
REPO_URL="${REPO_URL}"
INSTALL_DIR="/opt/netmon"
if [ "$(id -u)" -ne 0 ]; then echo "Please run with sudo:  sudo bash $0"; exit 1; fi
command -v git >/dev/null 2>&1 || { apt-get update -y && apt-get install -y git; }
if [ -d "$INSTALL_DIR/.git" ]; then git -C "$INSTALL_DIR" pull --ff-only || true; else git clone "$REPO_URL" "$INSTALL_DIR"; fi
cd "$INSTALL_DIR"
mkdir -p config
cat > config/provisioning.env <<'PROVEOF'
${provEnv}
PROVEOF
chmod 600 config/provisioning.env
exec ./install.sh
`;

  const downloadInstaller = () => {
    const blob = new Blob([installerScript], { type: "text/x-shellscript" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

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
      <SectionHeader
        icon={Rocket}
        title="Deploy a sensor here"
        meta={`${districtSlug}/${schoolSlug}`}
      />
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

        <div className="flex flex-col gap-3 rounded-lg border border-input p-3">
          <span className="text-xs font-medium text-muted-foreground">Options</span>
          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={cisHarden}
              onChange={(e) => setCisHarden(e.target.checked)}
              className="mt-0.5 size-4 rounded border-input accent-primary"
            />
            <span className="flex flex-col">
              <span className="text-sm font-medium">Apply CIS hardening</span>
              <span className="text-xs text-muted-foreground">
                Installs the NetMon-vetted safe subset (firewall with SSH preserved, auto-updates
                without auto-reboot, auditd, time sync…). SSH access is left untouched; reversible.
              </span>
            </span>
          </label>
          <div className="flex flex-col gap-2 border-t pt-3">
            <span className="text-sm font-medium">
              VLAN trunk monitoring <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            <p className="text-xs text-muted-foreground">
              If this box is on a switch <strong>trunk (802.1Q)</strong> port, list the VLAN IDs to
              monitor — the installer adds a sub-interface per VLAN (routes-off; your uplink is never
              touched). Leave blank for a normal access-port deploy.
            </p>
            <div className="flex flex-wrap gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">VLAN IDs (comma-separated)</label>
                <Input
                  value={vlanIds}
                  onChange={(e) => setVlanIds(e.target.value)}
                  placeholder="10,20,30"
                  className="h-9 w-48 font-mono"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Parent NIC (optional)</label>
                <Input
                  value={vlanParent}
                  onChange={(e) => setVlanParent(e.target.value)}
                  placeholder="auto (uplink)"
                  className="h-9 w-40 font-mono"
                />
              </div>
            </div>
            {vlanIds.trim() && (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">
                  Static IPs for no-DHCP VLANs (optional) — vlan:cidr, comma-separated
                </label>
                <Input
                  value={vlanStatics}
                  onChange={(e) => setVlanStatics(e.target.value)}
                  placeholder="30:10.0.30.9/24,40:10.0.40.9/24"
                  className="h-9 w-full max-w-md font-mono text-xs"
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <label className="text-xs font-medium">2. Download the installer + run it — nothing to edit</label>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={downloadInstaller}>
              <Download className="size-4" /> Download installer
            </Button>
            <code className="rounded bg-muted px-2 py-1 font-mono text-xs">sudo bash {fileName}</code>
          </div>
          <p className="text-xs text-muted-foreground">
            Downloads a ready-to-run script with this site’s config baked in — copy it to the new
            Ubuntu box and run the command above. It installs Docker + the collector, runs the
            hardening check, and enrolls the box into this spot. No files to edit.
          </p>
        </div>

        <p className="pt-1 text-xs font-medium text-muted-foreground">Or set it up by hand / inspect first:</p>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">Install commands</label>
            <CopyBtn text={installCmds} k="cmds" />
          </div>
          <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-2 font-mono text-xs">{installCmds}</pre>
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">
              Save as <span className="font-mono">config/provisioning.env</span>
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
