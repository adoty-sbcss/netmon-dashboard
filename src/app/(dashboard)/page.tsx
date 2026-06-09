import Link from "next/link";
import {
  Building2,
  ChevronRight,
  Network,
  School,
  ShieldAlert,
  Cpu,
} from "lucide-react";

import { redirect } from "next/navigation";

import { listDistricts } from "@/db/queries";
import { getSessionUser } from "@/lib/auth/current-user";
import { getUserScope } from "@/lib/auth/scope";
import { num, relativeTime, titleizeSlug } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AddLandingSpot } from "@/components/admin/add-landing-spot";

export default async function OverviewPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const scope = await getUserScope(user);
  const districts = await listDistricts({
    districtIds: scope.all ? null : scope.districtIds,
  });

  const totals = districts.reduce(
    (acc, d) => {
      acc.schools += d.schoolCount;
      acc.sensors += d.sensorCount;
      acc.hosts += d.hostCount;
      acc.findings += d.findingCount;
      return acc;
    },
    { schools: 0, sensors: 0, hosts: 0, findings: 0 },
  );

  // When there's a single district, the summary cards drill straight into it.
  // With several, the district grid below is the navigation.
  const only = districts.length === 1 ? `/${districts[0].slug}` : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Overview"
        description="Network health across all districts."
      />

      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <StatCard label="Districts" value={num(districts.length)} icon={Building2} href={only} />
        <StatCard label="Schools" value={num(totals.schools)} icon={School} href={only} />
        <StatCard label="Sensors" value={num(totals.sensors)} icon={Network} href="/sensors" />
        <StatCard
          label="Open findings"
          value={num(totals.findings)}
          icon={ShieldAlert}
          tone={totals.findings > 0 ? "warning" : "success"}
          href="/findings"
        />
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">Districts</h2>
          {user.role === "superadmin" && <AddLandingSpot kind="district" />}
        </div>
        {districts.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-primary/10">
                <Building2 className="size-6 text-primary" />
              </span>
              <p className="font-medium">No districts yet</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Ingest a NetMon bundle to populate the dashboard.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 md:gap-4 xl:grid-cols-3">
            {districts.map((d) => (
              <Link
                key={d.id}
                href={`/${d.slug}`}
                className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Card className="lift h-full hover:bg-accent/40">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Building2 className="size-4 text-primary" />
                      {d.name || titleizeSlug(d.slug)}
                    </CardTitle>
                    <CardAction>
                      <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </CardAction>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <School className="size-3.5" />
                        {num(d.schoolCount)} schools
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Network className="size-3.5" />
                        {num(d.sensorCount)} sensors
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Cpu className="size-3.5" />
                        {num(d.hostCount)} hosts
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      {d.findingCount > 0 ? (
                        <Badge variant="outline" className="gap-1 text-[var(--warning)]">
                          <ShieldAlert className="size-3" />
                          {num(d.findingCount)} findings
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          No findings
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {d.lastScanAt
                          ? `Updated ${relativeTime(d.lastScanAt)}`
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
    </div>
  );
}
