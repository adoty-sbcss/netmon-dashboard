import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, GitBranch, RouteOff, Waypoints } from "lucide-react";

import {
  getDistrictBySlug,
  getSchoolBySlug,
  listStpForSchool,
} from "@/db/queries";
import { dateTime, num, relativeTime, titleizeSlug } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
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

// Live data — never freeze at build time.
export const dynamic = "force-dynamic";

export default async function StpPage({
  params,
}: {
  params: Promise<{ district: string; school: string }>;
}) {
  const { district: districtSlug, school: schoolSlug } = await params;

  const district = await getDistrictBySlug(districtSlug);
  if (!district) notFound();
  const school = await getSchoolBySlug(district.id, schoolSlug);
  if (!school) notFound();

  const stp = await listStpForSchool(school.id);
  const basePath = `/${district.slug}/${school.slug}`;
  const multipleRoots = stp.rootBridges.length > 1;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={basePath}
          className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {school.name || titleizeSlug(school.slug)}
        </Link>
        <PageHeader
          title="Spanning-tree (STP) events"
          description={`${district.name} · BPDU activity seen on the wire by this school's sensors`}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <StatCard label="STP events" value={num(stp.total)} icon={RouteOff} />
        <StatCard
          label="Topology changes"
          value={num(stp.topologyChanges)}
          icon={Waypoints}
          tone={stp.topologyChanges > 0 ? "warning" : "success"}
          hint={stp.topologyChanges > 0 ? "TCN flags seen" : "stable"}
        />
        <StatCard
          label="Root bridges"
          value={num(stp.rootBridges.length)}
          icon={GitBranch}
          tone={multipleRoots ? "warning" : "default"}
          hint={multipleRoots ? "more than one root — check for instability" : undefined}
        />
      </div>

      {multipleRoots && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Observed root bridges</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {stp.rootBridges.map((rb) => (
              <Badge key={rb} variant="outline" className="font-mono text-xs">
                {rb}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Recent BPDUs
            {stp.total >= 500 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                (showing the latest 500)
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          {stp.rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <RouteOff className="size-7 text-muted-foreground" />
              <p className="text-sm font-medium">No STP events recorded</p>
              <p className="text-sm text-muted-foreground">
                Sensors at this school haven&apos;t captured any spanning-tree BPDUs yet.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="hidden sm:table-cell">TCN</TableHead>
                    <TableHead className="hidden md:table-cell">Root bridge</TableHead>
                    <TableHead className="hidden lg:table-cell">Bridge</TableHead>
                    <TableHead className="hidden lg:table-cell">Port</TableHead>
                    <TableHead className="hidden xl:table-cell text-right">Path cost</TableHead>
                    <TableHead className="hidden xl:table-cell">Sensor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stp.rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell title={r.seenAt ? dateTime(r.seenAt) : undefined}>
                        {r.seenAt ? relativeTime(r.seenAt) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-[10px] uppercase">
                          {r.bpduType ?? "bpdu"}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {r.topologyChange ? (
                          <Badge variant="outline" className="border-[var(--warning)] text-[var(--warning)]">
                            change
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs md:table-cell">
                        {r.rootBridgeId ?? "—"}
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs lg:table-cell">
                        {r.bridgeId ?? "—"}
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs lg:table-cell">
                        {r.portId ?? "—"}
                      </TableCell>
                      <TableCell className="hidden xl:table-cell text-right tabular-nums">
                        {r.rootPathCost != null ? num(r.rootPathCost) : "—"}
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs xl:table-cell">
                        {r.sensorSlug}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
