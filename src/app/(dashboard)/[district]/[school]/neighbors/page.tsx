import { notFound } from "next/navigation";
import { Waypoints } from "lucide-react";

import { getDistrictBySlug, getSchoolBySlug } from "@/db/queries";
import { listNeighborsForSchool } from "@/db/district-queries";
import { num, relativeTime, titleizeSlug } from "@/lib/format";
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

export const dynamic = "force-dynamic";

export default async function NeighborsPage({
  params,
}: {
  params: Promise<{ district: string; school: string }>;
}) {
  const { district: districtSlug, school: schoolSlug } = await params;
  const district = await getDistrictBySlug(districtSlug);
  if (!district) notFound();
  const school = await getSchoolBySlug(district.id, schoolSlug);
  if (!school) notFound();
  const neighbors = await listNeighborsForSchool(school.id);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="LLDP / CDP neighbors"
        description={`${school.name || titleizeSlug(school.slug)} · ${num(neighbors.length)} discovered adjacenc${neighbors.length === 1 ? "y" : "ies"}`}
      />
      <Card>
        <CardContent className="px-0 sm:px-6">
          {neighbors.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Waypoints className="size-8 text-muted-foreground" />
              <p className="font-medium">No LLDP/CDP neighbors</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                No link-layer discovery adjacencies were captured at this school
                yet (sensors learn these from LLDP/CDP frames on their segment).
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Local port</TableHead>
                    <TableHead>Neighbor</TableHead>
                    <TableHead>Remote port</TableHead>
                    <TableHead className="hidden md:table-cell">Mgmt IP</TableHead>
                    <TableHead className="hidden sm:table-cell">VLAN</TableHead>
                    <TableHead className="hidden lg:table-cell">Proto</TableHead>
                    <TableHead className="hidden xl:table-cell">Seen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {neighbors.map((n) => (
                    <TableRow key={n.id}>
                      <TableCell className="font-mono text-xs">
                        {n.localPort ?? "—"}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">
                          {n.systemName || n.chassisId || "—"}
                        </div>
                        {n.systemDescription && (
                          <div
                            className="max-w-xs truncate text-xs text-muted-foreground"
                            title={n.systemDescription}
                          >
                            {n.systemDescription}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {n.portId ?? n.portDescription ?? "—"}
                      </TableCell>
                      <TableCell className="hidden md:table-cell font-mono text-xs text-muted-foreground">
                        {n.mgmtIp ?? "—"}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell tabular-nums">
                        {n.vlanId ?? "—"}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {n.protocol ? (
                          <Badge variant="outline" className="text-[10px] uppercase">
                            {n.protocol}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="hidden xl:table-cell text-xs text-muted-foreground">
                        {n.seenAt ? relativeTime(n.seenAt) : "—"}
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
