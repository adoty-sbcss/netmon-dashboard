import Link from "next/link";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/current-user";
import { getUserScope } from "@/lib/auth/scope";
import { listFleetSensors, type FleetSensorRow } from "@/db/fleet-queries";
import { num, relativeTime, titleizeSlug } from "@/lib/format";
import {
  sensorHealthFlags,
  worstLevel,
  fleetTopSha,
  type HealthFlag,
} from "@/lib/sensor-health";
import { AlertTriangle, Radar, Rocket } from "lucide-react";

import { FleetUpdateAll } from "./fleet-update-all";
import { FleetApplyDefaults } from "./fleet-apply-defaults";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

// A sensor checks in every few minutes; no contact for an hour means it's
// likely offline and worth a look.
const STALE_MS = 60 * 60 * 1000;

/** Kept out of the component body so the `Date.now()` read isn't flagged as an
 *  impure call during render (same pattern as the shared relativeTime helper). */
function isStale(at: Date | null): boolean {
  return !at || Date.now() - new Date(at).getTime() > STALE_MS;
}

/** Health flags per sensor + the attention subset, computed once (off the render
 *  path so Date.now() inside the helper isn't flagged). */
function fleetHealth(rows: FleetSensorRow[]): {
  flagsById: Map<number, HealthFlag[]>;
  attention: { row: FleetSensorRow; flags: HealthFlag[] }[];
} {
  const top = fleetTopSha(rows.map((r) => r.reportedSha));
  const flagsById = new Map<number, HealthFlag[]>();
  const attention: { row: FleetSensorRow; flags: HealthFlag[] }[] = [];
  for (const row of rows) {
    const flags = sensorHealthFlags(row, { fleetTopSha: top });
    flagsById.set(row.id, flags);
    if (flags.length > 0) attention.push({ row, flags });
  }
  // errors first, then warns
  const rank = (fs: HealthFlag[]) => (worstLevel(fs) === "error" ? 0 : 1);
  attention.sort((a, b) => rank(a.flags) - rank(b.flags));
  return { flagsById, attention };
}

export default async function FleetSensorsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const scope = await getUserScope(user);
  const sensors = await listFleetSensors(scope.all ? null : scope.districtIds);

  const { flagsById, attention } = fleetHealth(sensors);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="All sensors"
        description={`${num(sensors.length)} sensor${sensors.length === 1 ? "" : "s"} across every district you oversee${
          attention.length > 0 ? ` · ${num(attention.length)} need attention` : ""
        }`}
        actions={
          user.role === "superadmin" ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/sensors/crawl"><Radar className="size-4" /> Crawl scope</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/sensors/releases"><Rocket className="size-4" /> Releases</Link>
              </Button>
              <FleetApplyDefaults />
              <FleetUpdateAll />
            </div>
          ) : undefined
        }
      />

      {attention.length > 0 && (
        <Card className="border-[var(--warning)]/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-[var(--warning)]" />
              Needs attention
              <span className="text-xs font-normal text-muted-foreground">
                {num(attention.length)} sensor{attention.length === 1 ? "" : "s"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {attention.map(({ row, flags }) => (
              <div
                key={row.id}
                className="flex flex-col gap-1 rounded-lg border p-2.5 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0">
                  <Link
                    href={`/${row.districtSlug}/${row.schoolSlug}/sensor/${row.id}`}
                    className="text-sm font-medium hover:underline"
                  >
                    {row.name || titleizeSlug(row.slug)}
                  </Link>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {row.districtName || titleizeSlug(row.districtSlug)} ·{" "}
                    {row.schoolName || titleizeSlug(row.schoolSlug)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {flags.map((f) => {
                    const cls = `rounded px-1.5 py-0.5 text-[11px] ${
                      f.level === "error"
                        ? "bg-destructive/10 text-destructive"
                        : "bg-[var(--warning)]/15 text-[var(--warning)]"
                    }`;
                    return f.help ? (
                      <Link key={f.code} href={`/help/${f.help}`} title={f.detail} className={`${cls} hover:underline`}>
                        {f.label} →
                      </Link>
                    ) : (
                      <span key={f.code} title={f.detail} className={cls}>
                        {f.label}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground">
              Click a sensor for detail. &quot;No version reported&quot; / &quot;No fresh data&quot; on a box
              that&apos;s still checking in usually means its update or upload silently broke — the kind
              of state that used to go unnoticed.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="px-0 sm:px-6">
          {sensors.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              No sensors are reporting yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sensor</TableHead>
                    <TableHead>School</TableHead>
                    <TableHead>District</TableHead>
                    <TableHead className="hidden md:table-cell">Local IP</TableHead>
                    <TableHead>Last check-in</TableHead>
                    <TableHead className="hidden lg:table-cell">Agent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sensors.map((s) => {
                    const stale = isStale(s.lastCheckinAt);
                    const level = worstLevel(flagsById.get(s.id) ?? []);
                    return (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">
                          {level && (
                            <span
                              className={`mr-1.5 inline-block size-2 rounded-full align-middle ${
                                level === "error" ? "bg-destructive" : "bg-[var(--warning)]"
                              }`}
                              title={level === "error" ? "Needs attention" : "Warning"}
                            />
                          )}
                          <Link
                            href={`/${s.districtSlug}/${s.schoolSlug}/sensor/${s.id}`}
                            className="hover:underline"
                          >
                            {s.name || titleizeSlug(s.slug)}
                          </Link>
                          <span className="ml-2 font-mono text-xs text-muted-foreground">
                            {s.slug}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/${s.districtSlug}/${s.schoolSlug}`}
                            className="text-sm hover:underline"
                          >
                            {s.schoolName || titleizeSlug(s.schoolSlug)}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/${s.districtSlug}`}
                            className="text-sm hover:underline"
                          >
                            {s.districtName || titleizeSlug(s.districtSlug)}
                          </Link>
                        </TableCell>
                        <TableCell className="hidden md:table-cell font-mono text-xs text-muted-foreground">
                          {s.localIp ?? "—"}
                        </TableCell>
                        <TableCell>
                          {s.lastCheckinAt == null ? (
                            <Badge variant="outline" className="text-muted-foreground">
                              no check-in
                            </Badge>
                          ) : (
                            <span
                              className={stale ? "text-[var(--warning)]" : undefined}
                            >
                              {relativeTime(s.lastCheckinAt)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell font-mono text-xs text-muted-foreground">
                          {s.agentVersion ?? "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
