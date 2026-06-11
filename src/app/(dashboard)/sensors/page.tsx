import Link from "next/link";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/current-user";
import { getUserScope } from "@/lib/auth/scope";
import { listFleetSensors } from "@/db/fleet-queries";
import { num, relativeTime, titleizeSlug } from "@/lib/format";
import { Radar, Rocket } from "lucide-react";

import { FleetUpdateAll } from "./fleet-update-all";
import { FleetApplyDefaults } from "./fleet-apply-defaults";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

export default async function FleetSensorsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const scope = await getUserScope(user);
  const sensors = await listFleetSensors(scope.all ? null : scope.districtIds);

  const staleCount = sensors.filter((s) => isStale(s.lastCheckinAt)).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="All sensors"
        description={`${num(sensors.length)} sensor${sensors.length === 1 ? "" : "s"} across every district you oversee${
          staleCount > 0 ? ` · ${num(staleCount)} need attention` : ""
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
                    return (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">
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
