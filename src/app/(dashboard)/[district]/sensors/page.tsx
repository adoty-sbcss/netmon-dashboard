import Link from "next/link";
import { notFound } from "next/navigation";

import { getDistrictBySlug } from "@/db/queries";
import { listDistrictSensors } from "@/db/district-queries";
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

export default async function DistrictSensorsPage({
  params,
}: {
  params: Promise<{ district: string }>;
}) {
  const { district: districtSlug } = await params;
  const district = await getDistrictBySlug(districtSlug);
  if (!district) notFound();
  const sensors = await listDistrictSensors(district.id);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="All sensors"
        description={`${district.name || titleizeSlug(district.slug)} · ${num(sensors.length)} sensor${sensors.length === 1 ? "" : "s"} across all schools`}
      />
      <Card>
        <CardContent className="px-0 sm:px-6">
          {sensors.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              No sensors enrolled in this district yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sensor</TableHead>
                    <TableHead>School</TableHead>
                    <TableHead className="hidden md:table-cell">Local IP</TableHead>
                    <TableHead>Last check-in</TableHead>
                    <TableHead className="hidden lg:table-cell">Agent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sensors.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/${district.slug}/${s.schoolSlug}/sensor/${s.id}`}
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
                          href={`/${district.slug}/${s.schoolSlug}`}
                          className="text-sm hover:underline"
                        >
                          {s.schoolName || titleizeSlug(s.schoolSlug)}
                        </Link>
                      </TableCell>
                      <TableCell className="hidden md:table-cell font-mono text-xs text-muted-foreground">
                        {s.localIp ?? "—"}
                      </TableCell>
                      <TableCell>
                        {s.lastCheckinAt ? (
                          relativeTime(s.lastCheckinAt)
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            no check-in
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell font-mono text-xs text-muted-foreground">
                        {s.agentVersion ?? "—"}
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
