import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { sensors, schools, districts } from "@/db/schema/app";
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
import { CrawlScopeForm } from "./crawl-scope-form";

export const dynamic = "force-dynamic";

/** Has the box applied the latest pushed config (which carries the crawl scope)? */
function rollout(
  reportedV: number | null,
  desiredV: number | null,
): { label: string; cls: string } {
  if (desiredV == null) return { label: "no config pushed", cls: "text-muted-foreground" };
  if (reportedV != null && reportedV >= desiredV)
    return { label: "synced", cls: "border-[var(--success)] text-[var(--success)]" };
  return { label: "pending", cls: "border-[var(--warning)] text-[var(--warning)]" };
}

/** The crawl scope an operator has PUSHED to each box (from desired config). */
function desiredScope(config: unknown): string {
  if (config && typeof config === "object") {
    const s = (config as Record<string, unknown>).snmp_topology_scope;
    if (typeof s === "string" && s) return s;
  }
  return "—";
}

export default async function CrawlScopePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "superadmin") redirect("/sensors");

  const rows = await db
    .select({
      id: sensors.id,
      name: sensors.name,
      slug: sensors.slug,
      schoolSlug: schools.slug,
      districtSlug: districts.slug,
      reportedConfigVersion: sensors.reportedConfigVersion,
      reportedConfigAt: sensors.reportedConfigAt,
      desiredVersion: desiredConfig.configVersion,
      desiredConfigData: desiredConfig.config,
    })
    .from(sensors)
    .innerJoin(schools, eq(schools.id, sensors.schoolId))
    .innerJoin(districts, eq(districts.id, schools.districtId))
    .leftJoin(desiredConfig, eq(desiredConfig.sensorId, sensors.id))
    .orderBy(districts.slug, schools.slug, sensors.slug);

  const pending = rows.filter(
    (r) => rollout(r.reportedConfigVersion, r.desiredVersion).label === "pending",
  ).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Topology crawl scope"
        description="Push the crawl scope (Full / Spine) + tuning to every sensor, then watch each box apply it on its next check-in."
      />

      <CrawlScopeForm sensorCount={rows.length} />

      <Card>
        <CardContent className="px-0 sm:px-6">
          <div className="px-6 pt-4 text-sm text-muted-foreground sm:px-0">
            Rollout — {pending === 0 ? "all sensors are on their latest pushed config" : `${pending} sensor(s) have not applied the latest config yet`}.
          </div>
          <div className="mt-3 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sensor</TableHead>
                  <TableHead>Pushed scope</TableHead>
                  <TableHead>Config (reported / desired)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Reported</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const st = rollout(r.reportedConfigVersion, r.desiredVersion);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        {r.name || titleizeSlug(r.slug)}
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {r.districtSlug}/{r.schoolSlug}/{r.slug}
                        </span>
                      </TableCell>
                      <TableCell className="capitalize">{desiredScope(r.desiredConfigData)}</TableCell>
                      <TableCell className="tabular-nums">
                        {r.reportedConfigVersion != null ? `v${r.reportedConfigVersion}` : "—"}
                        {" / "}
                        {r.desiredVersion != null ? `v${r.desiredVersion}` : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={st.cls}>{st.label}</Badge>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {r.reportedConfigAt ? relativeTime(r.reportedConfigAt) : "—"}
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
