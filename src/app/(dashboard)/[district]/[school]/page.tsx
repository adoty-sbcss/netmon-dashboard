import { notFound } from "next/navigation";
import {
  Cpu,
  HardDrive,
  Network,
  Radio,
  RouteOff,
  ShieldAlert,
  Waypoints,
} from "lucide-react";

import {
  getDistrictBySlug,
  getSchoolBySlug,
  getSchoolStats,
  listSensorsForSchool,
  listFindingsForSchool,
  getSchoolHealthTrend,
} from "@/db/queries";
import { dateTime, num, relativeTime, titleizeSlug } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { SeverityBadge } from "@/components/severity-badge";
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

  const [stats, sensors, findings, health] = await Promise.all([
    getSchoolStats(school.id),
    listSensorsForSchool(school.id),
    listFindingsForSchool(school.id),
    getSchoolHealthTrend(school.id),
  ]);

  const latestHealth = health.at(-1);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={school.name || titleizeSlug(school.slug)}
        description={`${district.name} · last scan ${relativeTime(stats.lastScanAt)}`}
      />

      {/* Primary metrics */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
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
        />
        <StatCard label="Sensors" value={num(sensors.length)} icon={Radio} />
        <StatCard
          label="Findings"
          value={num(stats.findingCount)}
          icon={ShieldAlert}
          tone={stats.findingCount > 0 ? "warning" : "success"}
        />
      </div>

      {/* Activity metrics */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <StatCard label="Neighbors (LLDP)" value={num(stats.neighborCount)} icon={Waypoints} />
        <StatCard
          label="DHCP observed"
          value={num(stats.dhcpCount)}
          icon={HardDrive}
          href={`/${district.slug}/${school.slug}/dhcp`}
        />
        <StatCard label="STP events" value={num(stats.stpCount)} icon={RouteOff} />
        <StatCard label="Devices seen" value={num(stats.deviceCount)} icon={Cpu} />
      </div>

      {/* Sensors */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sensors</CardTitle>
        </CardHeader>
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
                        {s.name || titleizeSlug(s.slug)}
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

      {/* Findings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Findings</CardTitle>
        </CardHeader>
        <CardContent>
          {findings.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <ShieldAlert className="size-7 text-[var(--success)]" />
              <p className="text-sm font-medium">No findings</p>
              <p className="text-sm text-muted-foreground">
                The most recent scans reported no issues at this school.
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {findings.map((f) => (
                <li key={f.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <SeverityBadge severity={f.severity} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{f.title}</p>
                    {f.detail && (
                      <p className="text-sm text-muted-foreground">{f.detail}</p>
                    )}
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {f.rule}
                      {f.createdAt ? ` · ${relativeTime(f.createdAt)}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

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
    </div>
  );
}
