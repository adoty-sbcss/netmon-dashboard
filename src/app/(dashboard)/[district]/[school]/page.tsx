import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Cpu,
  Globe,
  HardDrive,
  Network,
  Radio,
  Waypoints,
} from "lucide-react";

import {
  getDistrictBySlug,
  getSchoolBySlug,
  getSchoolStats,
  listSensorsForSchool,
  getSchoolHealthTrend,
} from "@/db/queries";
import { getLatestAiSummary } from "@/lib/ai/queries";
import { dateTime, num, relativeTime, titleizeSlug } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { SchoolTabs } from "@/components/school-tabs";
import { AiFindingsCard } from "@/components/ai-findings-card";
import { SectionHeader } from "@/components/section-header";
import { StatCard } from "@/components/stat-card";
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
import { headers } from "next/headers";
import { getSessionUser } from "@/lib/auth/current-user";
import { getEnrollmentView } from "@/lib/sensor/enrollment";
import { resolveSftpConfig } from "@/lib/ingest/settings";
import { getDistrictSftpCreds } from "@/lib/admin/sftp-provision";
import { DeploySensor } from "./deploy-sensor";
import { DeleteLandingSpot } from "@/components/admin/delete-landing-spot";

export default async function SchoolPage({
  params,
}: {
  params: Promise<{ district: string; school: string }>;
}) {
  const { district: districtSlug, school: schoolSlug } = await params;

  const district = await getDistrictBySlug(districtSlug);
  if (!district) notFound();
  const school = await getSchoolBySlug(district.id, schoolSlug);
  if (!school) notFound();

  const [stats, sensors, health, aiSummary] = await Promise.all([
    getSchoolStats(school.id),
    listSensorsForSchool(school.id),
    getSchoolHealthTrend(school.id),
    getLatestAiSummary(district.id, "school", school.id),
  ]);

  const latestHealth = health.at(-1);

  // PROV-2b: superadmin-only "Deploy a sensor here" (the provisioning block
  // carries the bootstrap key + SFTP password, so it's gated).
  const user = await getSessionUser();
  let deploy: {
    appOrigin: string;
    bootstrapKey: string | null;
    sftp: { host: string; port: number; user: string; password: string | null; remotePath: string } | null;
  } | null = null;
  if (user?.role === "superadmin") {
    const [enrollment, sftpResolved, hdrs] = await Promise.all([
      getEnrollmentView(),
      resolveSftpConfig(),
      headers(),
    ]);
    let appOrigin = (process.env.APP_ORIGIN ?? "").replace(/\/$/, "");
    if (!appOrigin) {
      const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host");
      const proto = hdrs.get("x-forwarded-proto") ?? "https";
      appOrigin = host ? `${proto}://${host}` : "";
    }
    // Prefer this district's SCOPED depot creds (SFTP-2b); fall back to the
    // shared fleet SFTP until the district's user has been minted.
    const districtCreds = await getDistrictSftpCreds(district.id);
    const c = sftpResolved.config;
    deploy = {
      appOrigin,
      bootstrapKey: enrollment.bootstrapKey,
      sftp: districtCreds
        ? {
            host: districtCreds.host,
            port: districtCreds.port,
            user: districtCreds.username,
            password: districtCreds.password,
            remotePath: districtCreds.remotePath,
          }
        : c
          ? {
              host: c.host,
              port: c.port,
              user: c.username,
              password: c.password ?? null,
              remotePath: c.baseDir || "/",
            }
          : null,
    };
  }

  return (
    <div className="flex flex-col gap-6">
      <SchoolTabs districtSlug={district.slug} schoolSlug={school.slug} />

      <PageHeader
        title={school.name || titleizeSlug(school.slug)}
        description={`${district.name} · last scan ${relativeTime(stats.lastScanAt)}`}
      />

      {/* Primary metrics — the at-a-glance health of the site */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-3">
        <StatCard
          label="Switches"
          value={num(stats.switchCount)}
          icon={Network}
          href={`/${district.slug}/${school.slug}/switches`}
        />
        <StatCard
          label="Hosts"
          value={num(stats.hostCount)}
          icon={Cpu}
          href={`/${district.slug}/${school.slug}/hosts`}
          hint={`${num(stats.deviceCount)} sightings across scans`}
        />
        <StatCard
          label="Sensors"
          value={num(sensors.length)}
          icon={Radio}
          href={
            sensors.length === 1
              ? `/${district.slug}/${school.slug}/sensor/${sensors[0].id}`
              : undefined
          }
        />
      </div>

      {/* Activity metrics — deeper telemetry */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-3">
        <StatCard
          label="Neighbors (LLDP)"
          value={num(stats.neighborCount)}
          icon={Waypoints}
          href={`/${district.slug}/${school.slug}/neighbors`}
        />
        <StatCard
          label="DHCP observed"
          value={num(stats.dhcpCount)}
          icon={HardDrive}
          href={`/${district.slug}/${school.slug}/dhcp`}
        />
        <StatCard
          label="DNS probes"
          value={num(stats.dnsCount)}
          icon={Globe}
          href={`/${district.slug}/${school.slug}/dns`}
        />
      </div>

      {/* AI analysis — under the telemetry it summarizes (Neighbors/DHCP/etc.). */}
      <AiFindingsCard summary={aiSummary} href={`/${district.slug}/${school.slug}/ai`} accent />

      {/* Sensors */}
      <Card>
        <SectionHeader icon={Radio} title="Sensors" />
        <CardContent className="px-0 sm:px-6">
          {sensors.length === 0 ? (
            <p className="px-6 py-6 text-sm text-muted-foreground">
              No sensors reporting at this school yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sensor</TableHead>
                    <TableHead className="text-right">Devices</TableHead>
                    <TableHead>Last scan</TableHead>
                    <TableHead className="hidden md:table-cell">Last check-in</TableHead>
                    <TableHead className="hidden lg:table-cell">Agent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sensors.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/${district.slug}/${school.slug}/sensor/${s.id}`}
                          className="hover:underline"
                        >
                          {s.name || titleizeSlug(s.slug)}
                        </Link>
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {s.slug}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {num(s.deviceCount)}
                      </TableCell>
                      <TableCell>
                        {s.lastScanAt ? (
                          <span title={dateTime(s.lastScanAt)}>
                            {relativeTime(s.lastScanAt)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">never</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {s.lastCheckinAt ? (
                          relativeTime(s.lastCheckinAt)
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            no check-in
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs text-muted-foreground lg:table-cell">
                        {s.agentVersion ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Deploy a sensor here — grouped with the Sensors section above. */}
      {deploy && (
        <DeploySensor
          appOrigin={deploy.appOrigin}
          bootstrapKey={deploy.bootstrapKey}
          sftp={deploy.sftp}
          districtName={district.name}
          districtSlug={district.slug}
          schoolName={school.name || titleizeSlug(school.slug)}
          schoolSlug={school.slug}
        />
      )}

      {/* Health snapshot */}
      {latestHealth && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Latest daily rollup
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {latestHealth.day}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
              {Object.entries(latestHealth.metrics).map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm text-muted-foreground">{k}</span>
                  <span className="font-medium tabular-nums">{num(Number(v))}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {user?.role === "superadmin" && (
        <div className="mt-2 border-t pt-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Danger zone</p>
          <DeleteLandingSpot kind="school" slug={school.slug} districtSlug={district.slug} />
        </div>
      )}
    </div>
  );
}
