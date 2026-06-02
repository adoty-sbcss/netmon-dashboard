import Link from "next/link";
import { notFound } from "next/navigation";
import { Boxes, Pencil, Plus, Upload } from "lucide-react";

import { getDistrictBySlug, getSchoolBySlug } from "@/db/queries";
import { listRegistryDevices, type RegistryDeviceRow } from "@/lib/registry/queries";
import { getSessionUser } from "@/lib/auth/current-user";
import { deviceTypeLabel, REGISTRY_STATUS_LABELS, type RegistryStatus } from "@/lib/registry/types";
import { relativeTime, titleizeSlug } from "@/lib/format";
import { SchoolTabs } from "@/components/school-tabs";
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

const STATUS_TONE: Record<RegistryStatus, string> = {
  active: "border-[var(--success)]/40 text-[var(--success)]",
  maintenance: "border-[var(--warning)]/40 text-[var(--warning)]",
  eol: "border-destructive/40 text-destructive",
  retired: "text-muted-foreground",
};

/** Lifecycle badge from resolved EOS date (today is the app's current date). */
function lifecycleBadge(d: RegistryDeviceRow) {
  if (!d.eosDate) return null;
  const eos = new Date(d.eosDate + "T00:00:00Z").getTime();
  const days = Math.round((eos - Date.now()) / 86_400_000);
  if (days < 0)
    return <Badge variant="outline" className="border-destructive/40 text-destructive">Past EOS</Badge>;
  if (days <= 90)
    return <Badge variant="outline" className="border-[var(--warning)]/40 text-[var(--warning)]">EOS in {days}d</Badge>;
  return null;
}

export default async function RegistryPage({
  params,
  searchParams,
}: {
  params: Promise<{ district: string; school: string }>;
  searchParams: Promise<{ retired?: string }>;
}) {
  const { district: districtSlug, school: schoolSlug } = await params;
  const { retired } = await searchParams;
  const showRetired = retired === "1";

  const district = await getDistrictBySlug(districtSlug);
  if (!district) notFound();
  const school = await getSchoolBySlug(district.id, schoolSlug);
  if (!school) notFound();

  const user = await getSessionUser();
  const isAdmin = user?.role === "superadmin";
  const basePath = `/${district.slug}/${school.slug}`;

  const devices = await listRegistryDevices({
    schoolId: school.id,
    includeRetired: showRetired,
  });

  return (
    <div className="flex flex-col gap-6">
      <SchoolTabs districtSlug={district.slug} schoolSlug={school.slug} />
      <PageHeader
        title="Equipment registry"
        description={`${school.name || titleizeSlug(school.slug)} · manually-tracked devices`}
        actions={
          isAdmin ? (
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href={`${basePath}/registry/import`}>
                  <Upload className="size-4" /> Import CSV
                </Link>
              </Button>
              <Button asChild size="sm">
                <Link href={`${basePath}/registry/new`}>
                  <Plus className="size-4" /> Add device
                </Link>
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="flex items-center gap-3 text-sm">
        <Link
          href={`${basePath}/registry`}
          className={!showRetired ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}
        >
          Active
        </Link>
        <Link
          href={`${basePath}/registry?retired=1`}
          className={showRetired ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}
        >
          Include retired
        </Link>
      </div>

      {devices.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Boxes className="size-8 text-muted-foreground" />
            <p className="font-medium">No registered devices</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Add devices manually or import a CSV to track equipment that scans
              can&apos;t fully identify — printers, cameras, IoT, and infrastructure.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="px-0 sm:px-6">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="hidden md:table-cell">IP / MAC</TableHead>
                    <TableHead className="hidden lg:table-cell">Room / IDF</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden sm:table-cell">Updated</TableHead>
                    {isAdmin && <TableHead className="w-12" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {devices.map((d) => (
                    <TableRow key={d.id} className={d.status === "retired" ? "opacity-60" : ""}>
                      <TableCell className="font-medium">
                        {d.name}
                        {d.vendor && (
                          <span className="ml-2 text-xs text-muted-foreground">{d.vendor}{d.model ? ` ${d.model}` : ""}</span>
                        )}
                      </TableCell>
                      <TableCell>{deviceTypeLabel(d.deviceType, d.deviceTypeOther)}</TableCell>
                      <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                        {d.ip ?? "—"}
                        {d.mac ? <div>{d.mac}</div> : null}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {[d.building, d.room].filter(Boolean).join(" / ") || "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className={STATUS_TONE[d.status as RegistryStatus] ?? ""}>
                            {REGISTRY_STATUS_LABELS[d.status as RegistryStatus] ?? d.status}
                          </Badge>
                          {lifecycleBadge(d)}
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                        {d.updatedAt ? relativeTime(d.updatedAt) : "—"}
                      </TableCell>
                      {isAdmin && (
                        <TableCell>
                          <Link
                            href={`${basePath}/registry/${d.id}/edit`}
                            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                          >
                            <Pencil className="size-3.5" /> Edit
                          </Link>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
