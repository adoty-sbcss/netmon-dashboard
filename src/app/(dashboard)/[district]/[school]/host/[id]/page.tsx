import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Cpu,
  Network,
  Radio,
  Tag,
} from "lucide-react";

import {
  getDistrictBySlug,
  getSchoolBySlug,
  getHostDetail,
} from "@/db/queries";
import { dateTime, relativeTime, titleizeSlug } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { DeviceTypeBadge } from "@/components/device-type-badge";
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

export default async function HostDetailPage({
  params,
}: {
  params: Promise<{ district: string; school: string; id: string }>;
}) {
  const { district: districtSlug, school: schoolSlug, id } = await params;

  const district = await getDistrictBySlug(districtSlug);
  if (!district) notFound();
  const school = await getSchoolBySlug(district.id, schoolSlug);
  if (!school) notFound();

  const entityId = Number.parseInt(id, 10);
  if (Number.isNaN(entityId)) notFound();

  const host = await getHostDetail(school.id, entityId);
  if (!host) notFound();

  const basePath = `/${district.slug}/${school.slug}`;
  const attrs = (host.attributes ?? {}) as Record<string, unknown>;
  // mDNS/SSDP service discovery — surfaced in its own block below, so keep it out
  // of the generic attribute badges to avoid double-rendering.
  const serviceHint = typeof attrs.service_hint === "string" ? attrs.service_hint : null;
  const services = Array.isArray(attrs.services) ? attrs.services.map(String) : [];
  const attrEntries = Object.entries(attrs).filter(
    ([k]) => k !== "service_hint" && k !== "services",
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`${basePath}/hosts`}
          className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Host inventory
        </Link>
        <PageHeader
          title={host.hostname || host.ip || host.mac}
          description={`${school.name || titleizeSlug(school.slug)} · ${district.name}`}
          actions={<DeviceTypeBadge type={host.deviceType} />}
        />
      </div>

      {/* Identity */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Cpu className="size-4 text-primary" />
            Identity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Hostname" value={host.hostname} />
            <Field label="IP address" value={host.ip} mono />
            <Field label="MAC address" value={host.mac} mono />
            <Field label="Vendor" value={host.vendor} />
            <Field
              label="Switch port"
              value={
                host.switchPort
                  ? host.switchPortSource
                    ? `${host.switchPort} · via ${host.switchPortSource}`
                    : host.switchPort
                  : null
              }
              mono
            />
            <Field label="First seen" value={host.firstSeenAt ? dateTime(host.firstSeenAt) : null} />
            <Field
              label="Last seen"
              value={host.lastSeenAt ? `${dateTime(host.lastSeenAt)} (${relativeTime(host.lastSeenAt)})` : null}
            />
          </dl>
          {(serviceHint || services.length > 0) && (
            <div className="mt-4 border-t pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <Radio className="size-4 text-primary" />
                <span className="text-sm font-medium">Service discovery (mDNS / SSDP)</span>
                {serviceHint && (
                  <Badge variant="secondary" className="capitalize">{serviceHint}</Badge>
                )}
              </div>
              {services.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {services.map((s) => (
                    <Badge key={s} variant="outline" className="font-mono text-[11px]">
                      {s}
                    </Badge>
                  ))}
                </div>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Advertised over Bonjour/UPnP — how this device was identified without SNMP.
              </p>
            </div>
          )}
          {attrEntries.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
              {attrEntries.map(([k, v]) => (
                <Badge key={k} variant="outline" className="gap-1 font-normal">
                  <Tag className="size-3 text-muted-foreground" />
                  <span className="text-muted-foreground">{k}:</span>
                  {String(v)}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* SNMP identity (when this host's IP was SNMP-polled, e.g. a gateway) */}
      {host.snmp.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Network className="size-4 text-primary" />
              SNMP attributes
            </CardTitle>
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
                  {host.snmp.map((a, i) => (
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

      {/* Sightings over time */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Sightings
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {host.sightings.length} across all scans
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          {host.sightings.length === 0 ? (
            <p className="px-6 py-6 text-sm text-muted-foreground">
              No per-scan sightings recorded.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Sensor</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead className="hidden md:table-cell">Hostname</TableHead>
                    <TableHead className="hidden lg:table-cell">Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {host.sightings.map((s) => (
                    <TableRow key={s.scanId}>
                      <TableCell title={dateTime(s.startedAt)}>
                        {s.startedAt ? relativeTime(s.startedAt) : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{s.sensorSlug}</TableCell>
                      <TableCell className="font-mono tabular-nums">{s.ip ?? "—"}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        {s.hostname ?? "—"}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {s.source ? (
                          <Badge variant="outline" className="text-[10px] uppercase">
                            {s.source}
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
