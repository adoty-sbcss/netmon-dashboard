import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Network, Radio } from "lucide-react";

import {
  getDistrictBySlug,
  getSchoolBySlug,
  listSwitchesForSchool,
  listReachabilityForSchool,
} from "@/db/queries";
import { relativeTime, titleizeSlug } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { SchoolTabs } from "@/components/school-tabs";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ReachabilityTable } from "./reachability-table";

export const dynamic = "force-dynamic";

export default async function SwitchesPage({
  params,
}: {
  params: Promise<{ district: string; school: string }>;
}) {
  const { district: districtSlug, school: schoolSlug } = await params;

  const district = await getDistrictBySlug(districtSlug);
  if (!district) notFound();
  const school = await getSchoolBySlug(district.id, schoolSlug);
  if (!school) notFound();

  const [switches, reachability] = await Promise.all([
    listSwitchesForSchool(school.id),
    listReachabilityForSchool(school.id),
  ]);
  const basePath = `/${district.slug}/${school.slug}`;

  return (
    <div className="flex flex-col gap-6">
      <SchoolTabs districtSlug={district.slug} schoolSlug={school.slug} />
      <PageHeader
        title="Switches & infrastructure"
        description={`${school.name || titleizeSlug(school.slug)} · discovered via LLDP/CDP neighbors`}
      />

      {/* SNMP reachability — which infrastructure devices are out there and
          which answer SNMP vs. only ping. */}
      {reachability.total > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <Radio className="size-4 text-primary" />
              Network device reachability
              {reachability.scanAt && (
                <span className="text-sm font-normal text-muted-foreground">
                  latest scan {relativeTime(reachability.scanAt)}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ReachabilityTable summary={reachability} />
            <p className="mt-3 text-xs text-muted-foreground">
              Devices that ping but don&apos;t answer SNMP usually have an SNMP ACL that
              excludes the sensor, or SNMP disabled — a clean Layer-1 map needs them to
              respond. Click a row to see its traceroute path.
            </p>
          </CardContent>
        </Card>
      )}

      {switches.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Network className="size-8 text-muted-foreground" />
            <p className="font-medium">No switches discovered</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Switches appear here once a sensor reports LLDP/CDP neighbors at this
              school.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 md:gap-4 xl:grid-cols-3">
          {switches.map((sw) => (
            <Link
              key={sw.id}
              href={`${basePath}/switch/${sw.id}`}
              className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Card className="h-full transition-colors hover:border-primary/40 hover:bg-accent/40">
                <CardHeader>
                  <CardTitle className="flex min-w-0 items-center gap-2 text-base">
                    <Network className="size-4 shrink-0 text-primary" />
                    <span className="truncate">
                      {sw.systemName || sw.mgmtIp || sw.chassisId}
                    </span>
                  </CardTitle>
                  <CardAction>
                    <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </CardAction>
                </CardHeader>
                <CardContent className="space-y-3">
                  {sw.systemDescription && (
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {sw.systemDescription}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {sw.mgmtIp && (
                      <Badge variant="outline" className="font-mono text-xs">
                        {sw.mgmtIp}
                      </Badge>
                    )}
                    {(sw.capabilities ?? []).map((c) => (
                      <Badge key={c} variant="secondary" className="text-[10px] uppercase">
                        {c}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {sw.lastSeenAt
                      ? `Last seen ${relativeTime(sw.lastSeenAt)}`
                      : "Not seen recently"}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
