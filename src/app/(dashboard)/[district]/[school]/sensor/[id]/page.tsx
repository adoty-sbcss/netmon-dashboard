import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Archive, ChevronDown, Download, Radio, Settings2, Wrench } from "lucide-react";
import { eq } from "drizzle-orm";

import {
  getDistrictBySlug,
  getSchoolBySlug,
  getSensorDetail,
  getSensorNetworks,
  listConfigBackups,
  getSensorManagement,
  type SensorDetail,
} from "@/db/queries";
import { db } from "@/db";
import { sensors as sensorsTable } from "@/db/schema/app";
import { getDistrictIperf, listIperfResults, listSpeedtestResults } from "@/lib/iperf";
import type { IperfScheduleEntry } from "@/lib/iperf-actions";
import { getSessionUser } from "@/lib/auth/current-user";
import { sensorHealthFlags, worstLevel } from "@/lib/sensor-health";
import { SensorManagementPanel } from "./sensor-management";
import { SensorHealthCard } from "./sensor-health";
import { IperfPanel } from "./iperf-panel";
import { SpeedtestPanel } from "./speedtest-panel";
import { VlanPanel } from "./vlan-panel";
import { NetworksCard } from "./networks-card";
import { dateTime, num, relativeTime, titleizeSlug } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

function fmtBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default async function SensorDetailPage({
  params,
}: {
  params: Promise<{ district: string; school: string; id: string }>;
}) {
  const { district: districtSlug, school: schoolSlug, id } = await params;

  const district = await getDistrictBySlug(districtSlug);
  if (!district) notFound();
  const school = await getSchoolBySlug(district.id, schoolSlug);
  if (!school) notFound();

  const sensorId = Number.parseInt(id, 10);
  if (Number.isNaN(sensorId)) notFound();

  const sensor = await getSensorDetail(school.id, sensorId);
  if (!sensor) notFound();

  // Box self-health (CPU/RAM/disk/OS/uptime) from the last check-in. Ungated —
  // visible to any viewer of the sensor, unlike the admin-only reported config.
  const [health] = await db
    .select({
      metrics: sensorsTable.reportedHostMetrics,
      metricsAt: sensorsTable.reportedMetricsAt,
    })
    .from(sensorsTable)
    .where(eq(sensorsTable.id, sensor.id))
    .limit(1);

  // Per-network / per-VLAN rollup (ungated, like the Status + Health cards).
  const networks = await getSensorNetworks(sensor.id);

  const user = await getSessionUser();
  const isAdmin = user?.role === "superadmin";
  const [backups, mgmt] = isAdmin
    ? await Promise.all([listConfigBackups(sensor.id), getSensorManagement(sensor.id)])
    : [[], null];
  // Actual config the box reported at its last check-in (ground truth).
  const [reported] = isAdmin
    ? await db
        .select({
          snmpEnabled: sensorsTable.reportedSnmpEnabled,
          snmpCommunities: sensorsTable.reportedSnmpCommunities,
          sftpEnabled: sensorsTable.reportedSftpEnabled,
          sftpHost: sensorsTable.reportedSftpHost,
          sftpPort: sensorsTable.reportedSftpPort,
          sftpUser: sensorsTable.reportedSftpUser,
          reportedAt: sensorsTable.reportedConfigAt,
        })
        .from(sensorsTable)
        .where(eq(sensorsTable.id, sensor.id))
        .limit(1)
    : [null];
  const [iperfCfg, iperfRuns, speedtestRuns] = isAdmin
    ? await Promise.all([
        getDistrictIperf(district.id),
        listIperfResults(sensor.id),
        listSpeedtestResults(sensor.id),
      ])
    : [{ serverHost: "", serverPort: 5201, enabled: false }, [], []];
  const dcfg = (mgmt?.config ?? {}) as Record<string, unknown>;
  const iperfSchedule = {
    enabled: Boolean(dcfg.iperf_enabled),
    schedules: Array.isArray(dcfg.iperf_schedules)
      ? (dcfg.iperf_schedules as IperfScheduleEntry[])
      : [],
  };
  const speedtestSchedule = {
    enabled: Boolean(dcfg.speedtest_enabled),
    providers:
      typeof dcfg.speedtest_providers === "string" ? dcfg.speedtest_providers : "cloudflare",
    scheduleSec:
      typeof dcfg.speedtest_schedule_sec === "number" ? dcfg.speedtest_schedule_sec : 6 * 3600,
    latencyEnabled: Boolean(dcfg.latency_enabled),
  };
  const basePath = `/${district.slug}/${school.slug}`;

  // Networks card: configured trunk VLANs + whether the box has applied the
  // current config (drives the "no data yet" vs "not applied" labels).
  const configuredVlans = String(dcfg.trunk_vlans ?? "")
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((v) => Number.isInteger(v) && v >= 1 && v <= 4094);
  const trunkParent = (dcfg.trunk_parent as string) || null;
  const configApplied = (sensor.reportedConfigVersion ?? -1) >= (mgmt?.configVersion ?? 0);

  // Attention flags — same logic as the fleet view. fleetTopSha isn't available
  // here (single sensor), so the "behind the fleet" check is skipped; the rest
  // (offline, update failing, no version, no fresh data, config stuck) all apply.
  const healthFlags = sensorHealthFlags(
    {
      lastCheckinAt: sensor.lastCheckinAt,
      reportedSha: sensor.reportedSha,
      lastUpdateStatus: sensor.lastUpdateStatus,
      lastUpdateReason: sensor.lastUpdateReason,
      configVersion: mgmt?.configVersion ?? null,
      reportedConfigVersion: sensor.reportedConfigVersion,
      lastScanAt: sensor.lastScanAt,
    },
    { fleetTopSha: null },
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={basePath}
          className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {school.name || titleizeSlug(school.slug)}
        </Link>
        <PageHeader
          title={sensor.name || titleizeSlug(sensor.slug)}
          description={`${district.name} · sensor / IDF`}
          actions={
            <Badge variant="outline" className="font-mono text-xs">{sensor.slug}</Badge>
          }
        />
      </div>

      {healthFlags.length > 0 && (
        <div
          className={`rounded-lg border p-3 ${
            worstLevel(healthFlags) === "error"
              ? "border-destructive/40 bg-destructive/5"
              : "border-[var(--warning)]/40 bg-[var(--warning)]/5"
          }`}
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="size-4" /> Needs attention
          </div>
          <ul className="mt-1.5 flex flex-col gap-1 text-xs">
            {healthFlags.map((f) => (
              <li key={f.code}>
                <span className="font-medium">{f.label}</span>
                {f.detail ? <span className="text-muted-foreground"> — {f.detail}</span> : null}
                {f.help ? (
                  <Link href={`/help/${f.help}`} className="ml-1 whitespace-nowrap font-medium text-primary hover:underline">
                    Fix this →
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Radio className="size-4 text-primary" />
            Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Scans collected" value={num(sensor.scanCount)} />
            <Field
              label="Last scan"
              value={sensor.lastScanAt ? `${dateTime(sensor.lastScanAt)} (${relativeTime(sensor.lastScanAt)})` : "never"}
            />
            <Field
              label="Agent version"
              value={`${sensor.agentVersion ?? "—"}${sensor.reportedSha ? ` · ${sensor.reportedSha.slice(0, 8)}` : ""}${sensor.reportedChannel ? ` (${sensor.reportedChannel})` : ""}`}
              mono
            />
            <Field
              label="Last check-in"
              value={sensor.lastCheckinAt ? relativeTime(sensor.lastCheckinAt) : "no check-in yet"}
            />
            <Field
              label="Local IP"
              value={sensor.localIp ? `${sensor.localIp}${sensor.iface ? ` (${sensor.iface})` : ""}` : "—"}
              mono
            />
            <Field label="Interface CIDR" value={sensor.ifaceCidr ?? "—"} mono />
            <Field label="Applied config version" value={sensor.reportedConfigVersion != null ? `v${sensor.reportedConfigVersion}` : "—"} />
            <Field label="First seen" value={sensor.createdAt ? dateTime(sensor.createdAt) : "—"} />
          </dl>
          {sensor.lastUpdateStatus && <LastUpdateBanner sensor={sensor} />}
        </CardContent>
      </Card>

      {/* Networks / VLANs — which are collecting + the IP each got */}
      <NetworksCard
        networks={networks}
        configuredVlans={configuredVlans}
        configApplied={configApplied}
        trunkParent={trunkParent}
      />

      {/* Sensor self-health — CPU/RAM/disk/OS/uptime + heartbeat */}
      <SensorHealthCard
        metrics={health?.metrics ?? null}
        metricsAt={health?.metricsAt ?? null}
        lastCheckinAt={sensor.lastCheckinAt}
      />

      {/* Reported (actual) config from the sensor's last check-in */}
      {isAdmin && reported && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <Settings2 className="size-4 text-primary" />
              Reported config (from the sensor)
              {sensor.reportedConfigVersion != null && mgmt?.configVersion != null && (
                <Badge
                  variant="outline"
                  className={
                    sensor.reportedConfigVersion >= mgmt.configVersion
                      ? "border-[var(--success)] text-[var(--success)]"
                      : "border-[var(--warning)] text-[var(--warning)]"
                  }
                >
                  {sensor.reportedConfigVersion >= mgmt.configVersion
                    ? `up to date (v${sensor.reportedConfigVersion})`
                    : `pending — applied v${sensor.reportedConfigVersion} of v${mgmt.configVersion}`}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field
                label="SNMP"
                value={
                  reported.snmpEnabled == null
                    ? "—"
                    : reported.snmpEnabled
                      ? "enabled"
                      : "disabled"
                }
              />
              <Field label="SNMP communities" value={reported.snmpCommunities || "—"} mono />
              <Field
                label="SFTP uploads"
                value={
                  reported.sftpEnabled == null
                    ? "—"
                    : reported.sftpEnabled
                      ? "enabled"
                      : "disabled"
                }
              />
              <Field
                label="SFTP server"
                value={reported.sftpHost ? `${reported.sftpHost}:${reported.sftpPort ?? 22}` : "—"}
                mono
              />
              <Field label="SFTP user" value={reported.sftpUser || "—"} mono />
              <Field
                label="Reported"
                value={reported.reportedAt ? relativeTime(reported.reportedAt) : "not yet reported"}
              />
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              Ground truth from the box&apos;s last check-in (the SFTP password is
              never reported). &quot;Not yet reported&quot; means the agent predates
              this feature — update the sensor.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Management (admin): enrollment, config push, commands */}
      {isAdmin && mgmt && (
        <SensorManagementPanel sensorId={sensor.id} basePath={basePath} mgmt={mgmt} />
      )}

      {/* Internet speed test (admin) */}
      {isAdmin && (
        <SpeedtestPanel
          sensorId={sensor.id}
          basePath={basePath}
          schedule={speedtestSchedule}
          results={speedtestRuns}
        />
      )}

      {/* iperf3 throughput (admin) */}
      {isAdmin && (
        <IperfPanel
          sensorId={sensor.id}
          basePath={basePath}
          districtSlug={district.slug}
          serverConfigured={iperfCfg.enabled && Boolean(iperfCfg.serverHost)}
          serverLabel={`${iperfCfg.serverHost}:${iperfCfg.serverPort}`}
          schedule={iperfSchedule}
          results={iperfRuns}
        />
      )}

      {/* VLAN trunk monitoring (admin) */}
      {isAdmin && mgmt && (
        <VlanPanel
          sensorId={sensor.id}
          basePath={basePath}
          currentVlans={String((mgmt.config?.trunk_vlans as string) ?? "")}
          currentParent={String((mgmt.config?.trunk_parent as string) ?? "")}
          currentStatics={String((mgmt.config?.trunk_statics as string) ?? "")}
        />
      )}

      {/* Config backups (admin) */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Archive className="size-4 text-primary" />
              Config backups
              <span className="text-sm font-normal text-muted-foreground">
                pulled from the sensor&apos;s daily SFTP backup
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0 sm:px-6">
            {backups.length === 0 ? (
              <p className="px-6 py-6 text-sm text-muted-foreground">
                No config backups stored yet. They appear here after the next SFTP sync
                picks up the sensor&apos;s <code>_config</code> upload.
              </p>
            ) : (
              <details className="group overflow-hidden rounded-lg border">
                <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent/40">
                  <span>View {backups.length} config backup{backups.length === 1 ? "" : "s"}</span>
                  <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
                </summary>
                <div className="overflow-x-auto border-t">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Backup</TableHead>
                      <TableHead className="hidden sm:table-cell">Captured</TableHead>
                      <TableHead className="hidden md:table-cell">Agent</TableHead>
                      <TableHead className="text-right">Size</TableHead>
                      <TableHead className="w-24 text-right">Download</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {backups.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="font-mono text-xs">{b.filename}</TableCell>
                        <TableCell className="hidden sm:table-cell" title={b.capturedAt ? dateTime(b.capturedAt) : undefined}>
                          {b.capturedAt ? relativeTime(b.capturedAt) : "—"}
                        </TableCell>
                        <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                          {String((b.manifest?.collector_version as string) ?? (b.manifest?.version as string) ?? "—")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtBytes(b.sizeBytes)}</TableCell>
                        <TableCell className="text-right">
                          <a
                            href={`/api/sensor/config-backup/${b.id}`}
                            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                          >
                            <Download className="size-3.5" /> ZIP
                          </a>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              </details>
            )}
            <p className="mt-3 flex items-center gap-1.5 px-6 text-xs text-muted-foreground sm:px-0">
              <Wrench className="size-3.5" />
              Restore a backup by downloading it and running{" "}
              <code>netmon-config-restore</code> on the box.
            </p>
          </CardContent>
        </Card>
      )}

    </div>
  );
}

/**
 * Banner showing the outcome of the box's last host-side auto-update. Turns a
 * fire-and-forget update into a visible result — a failed/stuck update now shows
 * WHY (e.g. "git fetch failed: dubious ownership") instead of looking like the
 * update silently worked. Fed by sensors.last_update_* (reported at check-in).
 */
function LastUpdateBanner({ sensor }: { sensor: SensorDetail }) {
  const status = sensor.lastUpdateStatus ?? "";
  const tone =
    status === "ok"
      ? "border-[var(--success)]/40 bg-[var(--success)]/5"
      : status === "rolled_back" || status === "skipped"
        ? "border-amber-500/40 bg-amber-500/5"
        : "border-destructive/40 bg-destructive/5";
  const label =
    status === "ok"
      ? "✓ Last update OK"
      : status === "rolled_back"
        ? "⚠ Last update auto-rolled-back"
        : status === "skipped"
          ? "Last update skipped"
          : "✗ Last update FAILED";
  let when = "";
  if (sensor.lastUpdateAt) {
    const d = new Date(sensor.lastUpdateAt);
    if (!Number.isNaN(d.getTime())) when = ` · ${relativeTime(d)}`;
  }
  return (
    <div className={`mt-4 rounded-lg border p-3 text-xs ${tone}`}>
      <span className="font-medium">
        {label}
        {when}
      </span>
      {sensor.lastUpdateReason && <span className="text-muted-foreground"> — {sensor.lastUpdateReason}</span>}
      {(sensor.lastUpdateFrom || sensor.lastUpdateTo) && (
        <span className="ml-1 font-mono text-[10px] text-muted-foreground">
          ({sensor.lastUpdateFrom?.slice(0, 8) || "?"} → {sensor.lastUpdateTo?.slice(0, 8) || "?"})
        </span>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 truncate ${mono ? "font-mono text-sm" : ""}`}>{value}</dd>
    </div>
  );
}
