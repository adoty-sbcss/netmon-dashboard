import Link from "next/link";
import { notFound } from "next/navigation";

import { getDistrictBySlug } from "@/db/queries";
import { listDistrictHosts } from "@/db/district-queries";
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

export default async function DistrictHostsPage({
  params,
}: {
  params: Promise<{ district: string }>;
}) {
  const { district: districtSlug } = await params;
  const district = await getDistrictBySlug(districtSlug);
  if (!district) notFound();
  const hosts = await listDistrictHosts(district.id);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="All hosts"
        description={`${district.name || titleizeSlug(district.slug)} · ${num(hosts.length)} devices across all schools`}
      />
      <Card>
        <CardContent className="px-0 sm:px-6">
          {hosts.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              No hosts recorded in this district yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>IP</TableHead>
                    <TableHead>Hostname</TableHead>
                    <TableHead className="hidden md:table-cell">Vendor</TableHead>
                    <TableHead className="hidden sm:table-cell">Type</TableHead>
                    <TableHead>School</TableHead>
                    <TableHead className="hidden lg:table-cell">Last seen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hosts.map((h) => (
                    <TableRow key={h.entityId}>
                      <TableCell className="font-mono text-sm">
                        {h.schoolSlug ? (
                          <Link
                            href={`/${district.slug}/${h.schoolSlug}/host/${h.entityId}`}
                            className="hover:underline"
                          >
                            {h.ip ?? "—"}
                          </Link>
                        ) : (
                          (h.ip ?? "—")
                        )}
                      </TableCell>
                      <TableCell>{h.hostname ?? "—"}</TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground">
                        {h.vendor ?? "—"}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {h.deviceType ? (
                          <Badge variant="outline" className="text-[10px] capitalize">
                            {h.deviceType}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        {h.schoolSlug ? (
                          <Link
                            href={`/${district.slug}/${h.schoolSlug}`}
                            className="text-sm hover:underline"
                          >
                            {h.schoolName || titleizeSlug(h.schoolSlug)}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                        {h.lastSeenAt ? relativeTime(h.lastSeenAt) : "—"}
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
