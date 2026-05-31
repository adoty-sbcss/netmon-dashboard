import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Archive, Download, Radio, Wrench } from "lucide-react";

import {
  getDistrictBySlug,
  getSchoolBySlug,
  getSensorDetail,
  listConfigBackups,
} from "@/db/queries";
import { getSessionUser } from "@/lib/auth/current-user";
import { dateTime, num, relativeTime, titleizeSlug } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
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

export const dynamic = "force-dynamic";

function fmtBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default async function SensorDetailPage({
  params,
}: {
  params: Promise<{ district: string; school: string; id: string }>;
}) {
  const { district: districtSlug, school: schoolSlug, id } = await params;

  const district = await getDistrictBySlug(districtSlug);
  if (!district) notFound();
  const school = await getSchoolBySlug(district.id, schoolSlug);
  if (!school) notFound();

  const sensorId = Number.parseInt(id, 10);
  if (Number.isNaN(sensorId)) notFound();

  const sensor = await getSensorDetail(school.id, sensorId);
  if (!sensor) notFound();

  const user = await getSessionUser();
  const isAdmin = user?.role === "superadmin";
  const backups = isAdmin ? await listConfigBackups(sensor.id) : [];
  const basePath = `/${district.slug}/${school.slug}`;

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
          title={sensor.name || titleizeSlug(sensor.slug)}
          description={`${district.name} · sensor / IDF`}
          actions={
            <Badge variant="outline" className="font-mono text-xs">{sensor.slug}</Badge>
          }
        />
      </div>

      {/* Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Radio className="size-4 text-primary" />
            Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Scans collected" value={num(sensor.scanCount)} />
            <Field
              label="Last scan"
              value={sensor.lastScanAt ? `${dateTime(sensor.lastScanAt)} (${relativeTime(sensor.lastScanAt)})` : "never"}
            />
            <Field label="Agent version" value={sensor.agentVersion ?? "—"} mono />
            <Field
              label="Last check-in"
              value={sensor.lastCheckinAt ? relativeTime(sensor.lastCheckinAt) : "— (management loop is Phase 1)"}
            />
            <Field label="Applied config version" value={sensor.reportedConfigVersion != null ? `v${sensor.reportedConfigVersion}` : "—"} />
            <Field label="First seen" value={sensor.createdAt ? dateTime(sensor.createdAt) : "—"} />
          </dl>
        </CardContent>
      </Card>

      {/* Config backups (admin) */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Archive className="size-4 text-primary" />
              Config backups
              <span className="text-sm font-normal text-muted-foreground">
                pulled from the sensor&apos;s daily SFTP backup
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0 sm:px-6">
            {backups.length === 0 ? (
              <p className="px-6 py-6 text-sm text-muted-foreground">
                No config backups stored yet. They appear here after the next SFTP sync
                picks up the sensor&apos;s <code>_config</code> upload.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Backup</TableHead>
                      <TableHead className="hidden sm:table-cell">Captured</TableHead>
                      <TableHead className="hidden md:table-cell">Agent</TableHead>
                      <TableHead className="text-right">Size</TableHead>
                      <TableHead className="w-24 text-right">Download</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {backups.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="font-mono text-xs">{b.filename}</TableCell>
                        <TableCell className="hidden sm:table-cell" title={b.capturedAt ? dateTime(b.capturedAt) : undefined}>
                          {b.capturedAt ? relativeTime(b.capturedAt) : "—"}
                        </TableCell>
                        <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                          {String((b.manifest?.collector_version as string) ?? (b.manifest?.version as string) ?? "—")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtBytes(b.sizeBytes)}</TableCell>
                        <TableCell className="text-right">
                          <a
                            href={`/api/sensor/config-backup/${b.id}`}
                            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                          >
                            <Download className="size-3.5" /> ZIP
                          </a>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <p className="mt-3 flex items-center gap-1.5 px-6 text-xs text-muted-foreground sm:px-0">
              <Wrench className="size-3.5" />
              Forcing a scan/upload, pushing SNMP strings, and restoring config arrive
              with the Phase 1 check-in loop.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 truncate ${mono ? "font-mono text-sm" : ""}`}>{value}</dd>
    </div>
  );
}
