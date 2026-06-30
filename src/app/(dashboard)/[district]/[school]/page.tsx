import { notFound } from "next/navigation";
import Link from "next/link";
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
  getSchoolHealthTrend,
} from "@/db/queries";
import { getLatestAiSummary } from "@/lib/ai/queries";
import { num, relativeTime, titleizeSlug } from "@/lib/format";
import { getSessionUser } from "@/lib/auth/current-user";
import { PageHeader } from "@/components/page-header";
import { SchoolTabs } from "@/components/school-tabs";
import { AiFindingsCard } from "@/components/ai-findings-card";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

  const [stats, health, aiSummary] = await Promise.all([
    getSchoolStats(school.id),
    getSchoolHealthTrend(school.id),
    getLatestAiSummary(district.id, "school", school.id),
  ]);

  const latestHealth = health.at(-1);
  const user = await getSessionUser();

  return (
    <div className="flex flex-col gap-6">
      <SchoolTabs districtSlug={district.slug} schoolSlug={school.slug} />

      <PageHeader
        title={school.name || titleizeSlug(school.slug)}
        description={`${district.name} · last scan ${relativeTime(stats.lastScanAt)}`}
      />

      {stats.sensorCount === 0 ? (
        /* No sensor reporting yet — point the user at the Sensors tab (where the
           deploy flow lives) instead of a wall of zeros. */
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-primary/10">
              <Radio className="size-6 text-primary" />
            </span>
            <p className="font-medium">No sensors here yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Once a NetMon sensor at this site checks in, its devices, telemetry,
              and health show up here.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button asChild>
                <Link href={`/${district.slug}/${school.slug}/sensors`}>
                  <Radio /> Set up a sensor
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/help/deploy-a-sensor">How it works</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Primary metrics — the at-a-glance health of the site */}
          <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-3">
            <StatCard
              label="Infrastructure"
              value={num(stats.switchCount)}
              icon={Network}
              href={`/${district.slug}/${school.slug}/inventory?type=switch`}
            />
            <StatCard
              label="Hosts"
              value={num(stats.hostCount)}
              icon={Cpu}
              href={`/${district.slug}/${school.slug}/hosts`}
              hint={`${num(stats.deviceCount)} seen in last scan`}
            />
            <StatCard
              label="Sensors"
              value={num(stats.sensorCount)}
              icon={Radio}
              href={`/${district.slug}/${school.slug}/sensors`}
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
        </>
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
