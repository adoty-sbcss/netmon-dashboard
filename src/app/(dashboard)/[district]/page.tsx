import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ChevronRight,
  Cpu,
  Network,
  School,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";

import {
  getDistrictBySlug,
  listSchools,
} from "@/db/queries";
import { getLatestAiSummary } from "@/lib/ai/queries";
import { num, relativeTime, titleizeSlug } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { AiFindingsCard } from "@/components/ai-findings-card";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth/current-user";
import { AddLandingSpot } from "@/components/admin/add-landing-spot";

export default async function DistrictPage({
  params,
}: {
  params: Promise<{ district: string }>;
}) {
  const { district: districtSlug } = await params;
  const district = await getDistrictBySlug(districtSlug);
  if (!district) notFound();
  const user = await getSessionUser();

  const [schools, aiSummary] = await Promise.all([
    listSchools(district.id),
    getLatestAiSummary(district.id, "district"),
  ]);

  const totals = schools.reduce(
    (acc, s) => {
      acc.sensors += s.sensorCount;
      acc.hosts += s.hostCount;
      acc.switches += s.switchCount;
      acc.findings += s.findingCount;
      return acc;
    },
    { sensors: 0, hosts: 0, switches: 0, findings: 0 },
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={district.name || titleizeSlug(district.slug)}
        description="District network summary."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/${district.slug}/ai`}>
                <Sparkles />
                AI analysis
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/${district.slug}/settings`}>
                <SlidersHorizontal />
                Settings
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-3">
        <StatCard label="Schools" value={num(schools.length)} icon={School} href="#schools" />
        <StatCard
          label="Sensors"
          value={num(totals.sensors)}
          icon={Network}
          href={`/${district.slug}/sensors`}
        />
        <StatCard
          label="Hosts"
          value={num(totals.hosts)}
          icon={Cpu}
          href={`/${district.slug}/hosts`}
        />
      </div>

      <div id="schools" className="scroll-mt-20">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">Schools</h2>
          {user?.role === "superadmin" && (
            <AddLandingSpot kind="school" districtSlug={district.slug} />
          )}
        </div>
        {schools.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-primary/10">
                <School className="size-6 text-primary" />
              </span>
              <p className="font-medium">No schools yet</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Schools appear here once a sensor at this district reports a scan.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 md:gap-4 xl:grid-cols-3">
            {schools.map((s) => (
              <Link
                key={s.id}
                href={`/${district.slug}/${s.slug}`}
                className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Card className="lift h-full hover:bg-accent/40">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <School className="size-4 text-primary" />
                      {s.name || titleizeSlug(s.slug)}
                    </CardTitle>
                    <CardAction>
                      <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </CardAction>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <Network className="size-3.5" />
                        {num(s.sensorCount)} sensors
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Cpu className="size-3.5" />
                        {num(s.hostCount)} hosts
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      {s.findingCount > 0 ? (
                        <Badge variant="outline" className="gap-1 text-[var(--warning)]">
                          <ShieldAlert className="size-3" />
                          {num(s.findingCount)} findings
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          No findings
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {s.lastScanAt
                          ? `Updated ${relativeTime(s.lastScanAt)}`
                          : "No scans"}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      <AiFindingsCard
        summary={aiSummary}
        href={`/${district.slug}/ai`}
        title="AI health summary"
      />
    </div>
  );
}
