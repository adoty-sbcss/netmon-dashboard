import { notFound } from "next/navigation";
import { Boxes, Radio, Wifi, WifiOff } from "lucide-react";

import { getDistrictBySlug, getSchoolBySlug } from "@/db/queries";
import { getInventoryForSchool, type InventoryRow } from "@/lib/inventory/queries";
import { getSessionUser } from "@/lib/auth/current-user";
import { relativeTime, titleizeSlug } from "@/lib/format";
import { SchoolTabs } from "@/components/school-tabs";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
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
import { SnmpGapCard } from "./inventory-snmp-gap";

export const dynamic = "force-dynamic";

function SnmpBadge({ status }: { status: InventoryRow["snmp"] }) {
  if (status === "responding")
    return <Badge variant="outline" className="border-[var(--success)]/40 text-[var(--success)]"><Radio className="mr-1 size-3" />SNMP</Badge>;
  if (status === "gap")
    return <Badge variant="outline" className="border-[var(--warning)]/40 text-[var(--warning)]">No SNMP</Badge>;
  return <span className="text-xs text-muted-foreground">—</span>;
}

function SourceBadge({ source }: { source: InventoryRow["source"] }) {
  const map = {
    discovered: { label: "Discovered", cls: "text-muted-foreground" },
    manual: { label: "Manual", cls: "border-primary/40 text-primary" },
    both: { label: "Registered", cls: "border-[var(--success)]/40 text-[var(--success)]" },
  } as const;
  const m = map[source];
  return <Badge variant="outline" className={"text-[10px] uppercase " + m.cls}>{m.label}</Badge>;
}

export default async function InventoryPage({
  params,
}: {
  params: Promise<{ district: string; school: string }>;
}) {
  const { district: districtSlug, school: schoolSlug } = await params;
  const district = await getDistrictBySlug(districtSlug);
  if (!district) notFound();
  const school = await getSchoolBySlug(district.id, schoolSlug);
  if (!school) notFound();

  const user = await getSessionUser();
  const isAdmin = user?.role === "superadmin";
  const basePath = `/${district.slug}/${school.slug}`;

  const inv = await getInventoryForSchool(school.id);
  const gaps = inv.rows
    .filter((r) => r.snmp === "gap")
    .map((r) => ({ key: r.key, name: r.name, ip: r.ip, vendor: r.vendor }));

  return (
    <div className="flex flex-col gap-6">
      <SchoolTabs districtSlug={district.slug} schoolSlug={school.slug} />
      <PageHeader
        title="Inventory"
        description={`${school.name || titleizeSlug(school.slug)} · discovered + registered devices`}
      />

      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <StatCard label="Devices" value={String(inv.total)} icon={Boxes} hint={`${inv.discovered} discovered · ${inv.manual} manual`} />
        <StatCard label="Online" value={String(inv.online)} icon={Wifi} />
        <StatCard label="Answering SNMP" value={String(inv.snmpResponding)} icon={Radio} tone="success" />
        <StatCard label="SNMP gaps" value={String(inv.snmpGaps)} icon={WifiOff} tone={inv.snmpGaps > 0 ? "warning" : "success"} />
      </div>

      <SnmpGapCard schoolId={school.id} basePath={basePath} gaps={gaps} isAdmin={isAdmin} />

      <Card>
        <CardContent className="px-0 sm:px-6">
          {inv.rows.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              No devices yet. They appear here as the sensor scans, or after you add them in the registry.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Device</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="hidden lg:table-cell">Vendor / model</TableHead>
                    <TableHead className="hidden md:table-cell">IP / MAC</TableHead>
                    <TableHead className="hidden xl:table-cell">Location</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>SNMP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inv.rows.map((r) => (
                    <TableRow key={r.key} className={r.snmp === "gap" ? "bg-[var(--warning)]/5" : ""}>
                      <TableCell>
                        <div className="flex items-center gap-2 font-medium">
                          <span className={r.online ? "size-2 shrink-0 rounded-full bg-[var(--success)]" : "size-2 shrink-0 rounded-full bg-muted-foreground/40"} />
                          {r.name}
                        </div>
                        <div className="mt-0.5"><SourceBadge source={r.source} /></div>
                      </TableCell>
                      <TableCell className="capitalize">{r.deviceType ?? "—"}</TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                        {[r.vendor, r.model].filter(Boolean).join(" ") || "—"}
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                        {r.ip ?? "—"}
                        {r.mac ? <div>{r.mac}</div> : null}
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">
                        {[r.building, r.room].filter(Boolean).join(" / ") || "—"}
                      </TableCell>
                      <TableCell>
                        <span className={r.online ? "text-[var(--success)]" : "text-muted-foreground"}>
                          {r.online ? "Online" : "Offline"}
                        </span>
                        {r.lastSeen && (
                          <div className="text-xs text-muted-foreground">{relativeTime(r.lastSeen)}</div>
                        )}
                      </TableCell>
                      <TableCell><SnmpBadge status={r.snmp} /></TableCell>
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
