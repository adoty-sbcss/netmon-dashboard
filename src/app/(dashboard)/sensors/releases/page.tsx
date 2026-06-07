import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { sensors, schools, districts, releaseSettings } from "@/db/schema/app";
import { desiredConfig } from "@/db/schema/management";
import { getSessionUser } from "@/lib/auth/current-user";
import { relativeTime, titleizeSlug } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PinStableForm, ChannelPicker } from "./release-controls";

export const dynamic = "force-dynamic";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export default async function ReleasesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "superadmin") redirect("/sensors");

  const [rows, [rel]] = await Promise.all([
    db
      .select({
        id: sensors.id,
        name: sensors.name,
        slug: sensors.slug,
        schoolSlug: schools.slug,
        districtSlug: districts.slug,
        agentVersion: sensors.agentVersion,
        reportedSha: sensors.reportedSha,
        reportedChannel: sensors.reportedChannel,
        lastCheckinAt: sensors.lastCheckinAt,
        desiredConfigData: desiredConfig.config,
      })
      .from(sensors)
      .innerJoin(schools, eq(schools.id, sensors.schoolId))
      .innerJoin(districts, eq(districts.id, schools.districtId))
      .leftJoin(desiredConfig, eq(desiredConfig.sensorId, sensors.id))
      .orderBy(districts.slug, schools.slug, sensors.slug),
    db.select({ sha: releaseSettings.stableSha }).from(releaseSettings).limit(1),
  ]);

  const stableSha = rel?.sha ?? null;
  // Pushed channel = what desired-config says; defaults to 'stable' when unset.
  const pushedChannel = (cfg: unknown): string => {
    const c = cfg && typeof cfg === "object" ? (cfg as Record<string, unknown>).update_channel : null;
    return typeof c === "string" && c ? c : "stable";
  };
  const canaryCount = rows.filter((r) => pushedChannel(r.desiredConfigData) === "canary").length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Releases & canary"
        description="Pin the fleet to a validated release; promote new code to a canary cohort first, watch them, then promote fleet-wide."
      />

      <PinStableForm currentSha={stableSha} />

      <Card>
        <CardContent className="px-0 sm:px-6">
          <div className="px-6 pt-4 text-sm text-muted-foreground sm:px-0">
            {canaryCount === 0
              ? "No sensors on the canary channel. Set a few boxes to 'canary' to trial a new main push before promoting."
              : `${canaryCount} sensor(s) on canary (tracking latest main). Watch their reported commit + health, then Pin to promote.`}
          </div>
          <div className="mt-3 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sensor</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Reported commit</TableHead>
                  <TableHead className="hidden md:table-cell">Agent ver</TableHead>
                  <TableHead className="hidden sm:table-cell">Last check-in</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const reportedSha = str(r.reportedSha);
                  const onStable = reportedSha && stableSha && reportedSha.startsWith(stableSha.slice(0, 12));
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        {r.name || titleizeSlug(r.slug)}
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {r.districtSlug}/{r.schoolSlug}/{r.slug}
                        </span>
                      </TableCell>
                      <TableCell>
                        <ChannelPicker sensorId={r.id} current={pushedChannel(r.desiredConfigData)} />
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {reportedSha ? reportedSha.slice(0, 10) : "—"}
                        {onStable ? (
                          <Badge variant="outline" className="ml-2 border-[var(--success)] text-[var(--success)]">on stable</Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                        {r.agentVersion || "—"}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {r.lastCheckinAt ? relativeTime(r.lastCheckinAt) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
