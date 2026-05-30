import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Cable, Network, Tag } from "lucide-react";

import {
  getDistrictBySlug,
  getSchoolBySlug,
  getSwitchDetail,
} from "@/db/queries";
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

export default async function SwitchDetailPage({
  params,
}: {
  params: Promise<{ district: string; school: string; id: string }>;
}) {
  const { district: districtSlug, school: schoolSlug, id } = await params;

  const district = await getDistrictBySlug(districtSlug);
  if (!district) notFound();
  const school = await getSchoolBySlug(district.id, schoolSlug);
  if (!school) notFound();

  const switchId = Number.parseInt(id, 10);
  if (Number.isNaN(switchId)) notFound();

  const sw = await getSwitchDetail(school.id, switchId);
  if (!sw) notFound();

  const basePath = `/${district.slug}/${school.slug}`;
  const attrEntries = Object.entries(sw.attributes ?? {});

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`${basePath}/switches`}
          className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Switches
        </Link>
        <PageHeader
          title={sw.systemName || sw.mgmtIp || sw.chassisId}
          description={`${school.name || titleizeSlug(school.slug)} · ${district.name}`}
          actions={
            sw.interfaceCount > 0 ? (
              <Badge variant="outline" className="gap-1.5">
                <Cable className="size-3.5" />
                {num(sw.interfaceCount)} interfaces
              </Badge>
            ) : undefined
          }
        />
      </div>

      {/* Identity */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Network className="size-4 text-primary" />
            Identity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="System name" value={sw.systemName} />
            <Field label="Management IP" value={sw.mgmtIp} mono />
            <Field label="Chassis ID" value={sw.chassisId} mono />
            <Field label="First seen" value={sw.firstSeenAt ? dateTime(sw.firstSeenAt) : null} />
            <Field
              label="Last seen"
              value={sw.lastSeenAt ? `${dateTime(sw.lastSeenAt)} (${relativeTime(sw.lastSeenAt)})` : null}
            />
          </dl>
          {sw.systemDescription && (
            <p className="mt-4 border-t pt-4 text-sm text-muted-foreground">
              {sw.systemDescription}
            </p>
          )}
          {(sw.capabilities?.length || attrEntries.length) ? (
            <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
              {(sw.capabilities ?? []).map((c) => (
                <Badge key={c} variant="secondary" className="text-[10px] uppercase">
                  {c}
                </Badge>
              ))}
              {attrEntries.map(([k, v]) => (
                <Badge key={k} variant="outline" className="gap-1 font-normal">
                  <Tag className="size-3 text-muted-foreground" />
                  <span className="text-muted-foreground">{k}:</span>
                  {String(v)}
                </Badge>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* SNMP attributes */}
      {sw.snmp.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">SNMP attributes</CardTitle>
          </CardHeader>
          <CardContent className="px-0 sm:px-6">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Attribute</TableHead>
                    <TableHead>Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sw.snmp.map((a, i) => (
                    <TableRow key={`${a.oidName}-${i}`}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {a.oidName ?? "—"}
                      </TableCell>
                      <TableCell className="break-all">{a.value ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* LLDP appearances over time */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Neighbor sightings
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              how sensors see this switch on the wire
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          {sw.appearances.length === 0 ? (
            <p className="px-6 py-6 text-sm text-muted-foreground">
              No neighbor sightings recorded.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Sensor</TableHead>
                    <TableHead>Local port</TableHead>
                    <TableHead className="hidden md:table-cell">Remote port</TableHead>
                    <TableHead className="hidden lg:table-cell">VLAN</TableHead>
                    <TableHead className="hidden lg:table-cell">Proto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sw.appearances.map((a) => (
                    <TableRow key={a.scanId}>
                      <TableCell title={dateTime(a.startedAt)}>
                        {a.startedAt ? relativeTime(a.startedAt) : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{a.sensorSlug}</TableCell>
                      <TableCell className="font-mono text-xs">{a.localPort ?? "—"}</TableCell>
                      <TableCell className="hidden font-mono text-xs md:table-cell">
                        {a.portId ?? a.portDescription ?? "—"}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {a.vlanId ?? "—"}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {a.protocol ? (
                          <Badge variant="outline" className="text-[10px] uppercase">
                            {a.protocol}
                          </Badge>
                        ) : (
                          "—"
                        )}
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

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 truncate ${mono ? "font-mono" : ""}`}>
        {value ?? <span className="text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}
