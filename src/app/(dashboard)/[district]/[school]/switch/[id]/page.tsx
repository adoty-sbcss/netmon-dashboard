import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Cable, Network, Tag } from "lucide-react";

import {
  getDistrictBySlug,
  getSchoolBySlug,
  getSwitchDetail,
} from "@/db/queries";
import { getDistrictSnmpCommunity } from "@/db/settings-queries";
import { getSessionUser } from "@/lib/auth/current-user";
import { dateTime, num, relativeTime, titleizeSlug } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
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
import { NeighborSightings } from "./neighbor-sightings";

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

  const user = await getSessionUser();
  const isSuperadmin = user?.role === "superadmin";
  const community = isSuperadmin ? await getDistrictSnmpCommunity(sw.districtId) : "";

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
        <SectionHeader icon={Network} title="Identity" />
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

      {/* Per-port detail consolidated with the devices plugged into each port. */}
      <SwitchPortsTable
        ports={sw.ports}
        connectedDevices={sw.connectedDevices}
        basePath={basePath}
      />

      {/* SNMP — settings + identity. */}
      {sw.mgmtIp && (
        <Card>
          <SectionHeader icon={Network} title="SNMP" />
          <CardContent className="flex flex-col gap-4">
            <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="min-w-0">
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Status</dt>
                <dd className="mt-0.5">
                  {sw.snmpResponded === true ? (
                    <span className="text-emerald-600 dark:text-emerald-400">
                      Responded{sw.snmpVersion ? ` (v${sw.snmpVersion})` : ""}
                    </span>
                  ) : sw.snmpResponded === false ? (
                    <span className="text-muted-foreground">No response</span>
                  ) : (
                    <span className="text-muted-foreground">Not probed</span>
                  )}
                </dd>
              </div>
              <Field
                label="Last checked"
                value={sw.snmpCheckedAt ? `${dateTime(sw.snmpCheckedAt)} (${relativeTime(sw.snmpCheckedAt)})` : null}
              />
              <div className="min-w-0">
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Works on this device
                </dt>
                <dd className="mt-0.5 truncate font-mono">
                  {sw.snmpCredential?.community ? (
                    isSuperadmin ? (
                      sw.snmpCredential.community
                    ) : (
                      <span className="font-sans text-muted-foreground">•••••• (admin only)</span>
                    )
                  ) : (sw.snmpCredential?.failureCount ?? 0) > 0 ? (
                    <span className="font-sans text-muted-foreground">
                      none worked ({sw.snmpCredential?.failureCount} fails)
                    </span>
                  ) : (
                    <span className="font-sans text-muted-foreground">—</span>
                  )}
                </dd>
                {sw.snmpCredential?.lastSucceededAt && (
                  <div className="text-xs text-muted-foreground">
                    last ok {relativeTime(sw.snmpCredential.lastSucceededAt)}
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
                  districtId={sw.districtId}
                  basePath={basePath}
                  current={community}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Read-only SNMP, v2c. This community is district-wide — changing it here
                  re-pushes to every sensor in {district.name}.
                </p>
              </div>
            )}

            {sw.snmp.length > 0 && (
              <div className="overflow-x-auto border-t pt-4">
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
            )}
          </CardContent>
        </Card>
      )}

      {/* LLDP/CDP neighbor sightings — collapsed to the most recent by default. */}
      <NeighborSightings appearances={sw.appearances} />
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
