import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Cpu,
  Fingerprint,
  Map as MapIcon,
  Network,
  Radio,
  ShieldAlert,
  Tag,
} from "lucide-react";

import {
  getDistrictBySlug,
  getSchoolBySlug,
  getHostDetail,
  getDeviceIssues,
} from "@/db/queries";
import { getDistrictSnmpCommunity } from "@/db/settings-queries";
import { getSessionUser } from "@/lib/auth/current-user";
import { dateTime, relativeTime, titleizeSlug } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { DeviceTypeBadge } from "@/components/device-type-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/section-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SwitchPortsTable } from "@/components/device/switch-ports-table";
import { SnmpCommunityForm } from "../../../../settings/network/snmp-community-form";
import { DeviceSightings } from "./device-sightings";
import { HostReclassify } from "./host-reclassify";

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

  const user = await getSessionUser();
  const isSuperadmin = user?.role === "superadmin";

  const [community, deviceIssues] = await Promise.all([
    isSuperadmin ? getDistrictSnmpCommunity(host.districtId) : Promise.resolve(""),
    getDeviceIssues(host.districtId, school.id, {
      ip: host.ip,
      mac: host.mac,
      hostname: host.hostname,
    }),
  ]);

  const basePath = `/${district.slug}/${school.slug}`;
  const attrs = host.attributes;
  // mDNS/SSDP service discovery — surfaced in its own block below, so keep it out
  // of the generic attribute badges to avoid double-rendering.
  const serviceHint = typeof attrs.service_hint === "string" ? attrs.service_hint : null;
  const services = Array.isArray(attrs.services) ? attrs.services.map(String) : [];
  const attrEntries = Object.entries(attrs).filter(
    ([k]) =>
      k !== "service_hint" &&
      k !== "services" &&
      k !== "model" &&
      k !== "serial" &&
      k !== "classification",
  );

  // Reverse view: where this host is plugged in — switch NAME (fall back to its
  // mgmt IP) + the access port the bridge FDB resolved.
  const switchWhere = host.switchName || host.switchPortSource;
  const connectedTo = host.switchPort
    ? switchWhere
      ? `${switchWhere} · ${host.switchPort}`
      : host.switchPort
    : null;

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
          actions={
            <div className="flex items-center gap-2">
              <DeviceTypeBadge type={host.deviceType} />
              <Button asChild variant="outline" size="sm">
                <Link href={`${basePath}/map`}>
                  <MapIcon className="size-4" /> View on map
                </Link>
              </Button>
            </div>
          }
        />
        {isSuperadmin && (
          <div className="mt-3">
            <HostReclassify
              hostId={host.id}
              basePath={basePath}
              current={host.deviceType}
              override={host.deviceTypeOverride}
              auto={host.deviceTypeAuto}
            />
          </div>
        )}
      </div>

      {/* Identity */}
      <Card>
        <SectionHeader icon={Cpu} title="Identity" />
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Hostname" value={host.hostname} />
            <Field label="IP address" value={host.ip} mono />
            <Field label="MAC address" value={host.mac} mono />
            <Field label="Vendor" value={host.vendor} />
            <Field label="Model" value={host.model} />
            <Field label="Serial" value={host.serial} mono />
            <div className="min-w-0">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Connected to
              </dt>
              <dd className="mt-0.5 truncate font-mono">
                {connectedTo ? (
                  host.switchEntityId ? (
                    <Link
                      href={`${basePath}/switch/${host.switchEntityId}`}
                      className="text-primary hover:underline"
                    >
                      {connectedTo}
                    </Link>
                  ) : (
                    connectedTo
                  )
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </dd>
            </div>
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

      {/* Ports + connected devices (consolidated) — when this host is itself infra. */}
      <SwitchPortsTable
        ports={host.ports}
        connectedDevices={host.connectedDevices}
        basePath={basePath}
      />

      {/* SNMP — settings + identity (when this host has an IP we can poll). */}
      {host.ip && (
        <Card>
          <SectionHeader icon={Network} title="SNMP" />
          <CardContent className="flex flex-col gap-4">
            <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="min-w-0">
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Status</dt>
                <dd className="mt-0.5">
                  {host.snmpResponded === true ? (
                    <span className="text-emerald-600 dark:text-emerald-400">
                      Responded{host.snmpVersion ? ` (v${host.snmpVersion})` : ""}
                    </span>
                  ) : host.snmpResponded === false ? (
                    <span className="text-muted-foreground">No response</span>
                  ) : (
                    <span className="text-muted-foreground">Not probed</span>
                  )}
                </dd>
              </div>
              <Field
                label="Last checked"
                value={host.snmpCheckedAt ? `${dateTime(host.snmpCheckedAt)} (${relativeTime(host.snmpCheckedAt)})` : null}
              />
              <div className="min-w-0">
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Works on this device
                </dt>
                <dd className="mt-0.5 truncate font-mono">
                  {host.snmpCredential?.community ? (
                    isSuperadmin ? (
                      host.snmpCredential.community
                    ) : (
                      <span className="font-sans text-muted-foreground">•••••• (admin only)</span>
                    )
                  ) : (host.snmpCredential?.failureCount ?? 0) > 0 ? (
                    <span className="font-sans text-muted-foreground">
                      none worked ({host.snmpCredential?.failureCount} fails)
                    </span>
                  ) : (
                    <span className="font-sans text-muted-foreground">—</span>
                  )}
                </dd>
                {host.snmpCredential?.lastSucceededAt && (
                  <div className="text-xs text-muted-foreground">
                    last ok {relativeTime(host.snmpCredential.lastSucceededAt)}
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Read community (district)
                </dt>
                <dd className="mt-0.5 truncate font-mono">
                  {isSuperadmin ? (
                    community ? (
                      community
                    ) : (
                      <span className="text-muted-foreground">not set</span>
                    )
                  ) : (
                    <span className="text-muted-foreground">•••••• (admin only)</span>
                  )}
                </dd>
              </div>
            </dl>

            {isSuperadmin && (
              <div className="border-t pt-4">
                <SnmpCommunityForm
                  districtId={host.districtId}
                  basePath={basePath}
                  current={community}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Read-only SNMP, v2c. This community is district-wide — changing it here
                  re-pushes to every sensor in {district.name}.
                </p>
              </div>
            )}

            {host.snmp.length > 0 && (
              <div className="overflow-x-auto border-t pt-4">
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
            )}
          </CardContent>
        </Card>
      )}

      {/* DHCP fingerprint — identity for endpoints that never speak SNMP. */}
      {host.dhcp && (
        <Card>
          <SectionHeader
            icon={Fingerprint}
            title="DHCP fingerprint"
            meta={host.dhcp.seenAt ? `last seen ${relativeTime(host.dhcp.seenAt)}` : undefined}
          />
          <CardContent>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Vendor class (opt 60)" value={host.dhcp.vendorClassId} />
              <Field label="Advertised hostname (opt 12)" value={host.dhcp.clientHostname} />
              <Field label="Requested options (opt 55)" value={host.dhcp.paramReqList} mono />
            </dl>
          </CardContent>
        </Card>
      )}

      {/* Findings that mention this device (heuristic match). */}
      {deviceIssues.length > 0 && (
        <Card>
          <SectionHeader
            icon={ShieldAlert}
            title="Findings about this device"
            meta={deviceIssues.length}
          />
          <CardContent className="flex flex-col gap-3">
            {deviceIssues.map((it) => (
              <div key={it.id} className="flex flex-col gap-1 border-b pb-3 last:border-b-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={severityClass(it.severity)}>
                    {it.severity}
                  </Badge>
                  <Link
                    href={`/${district.slug}/issues`}
                    className="text-sm font-medium hover:underline"
                  >
                    {it.title}
                  </Link>
                </div>
                {it.recommendation && (
                  <p className="text-xs text-muted-foreground">{it.recommendation}</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Sightings over time — collapsed by default. */}
      <DeviceSightings sightings={host.sightings} />
    </div>
  );
}

function severityClass(severity: string): string {
  const s = severity.toLowerCase();
  if (s === "critical" || s === "high") return "text-destructive";
  if (s === "medium" || s === "warning") return "text-[var(--warning)]";
  return "text-muted-foreground";
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
