import { notFound } from "next/navigation";
import { Boxes, Radio, Wifi, WifiOff } from "lucide-react";

import { getDistrictBySlug, getSchoolBySlug, listReachabilityForSchool } from "@/db/queries";
import { listNeighborsForSchool } from "@/db/district-queries";
import {
  getInventoryForSchool,
  listExcludedForSchool,
  getSchoolSnmpEnabled,
  type ExcludedRow,
} from "@/lib/inventory/queries";
import { getSessionUser } from "@/lib/auth/current-user";
import { titleizeSlug } from "@/lib/format";
import { SchoolTabs } from "@/components/school-tabs";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { SnmpGapCard } from "./inventory-snmp-gap";
import { DevicesHub, type NeighborLink } from "./devices-hub";

export const dynamic = "force-dynamic";

export default async function DevicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ district: string; school: string }>;
  searchParams: Promise<{ tab?: string; type?: string; source?: string }>;
}) {
  const { district: districtSlug, school: schoolSlug } = await params;
  const sp = await searchParams;
  const district = await getDistrictBySlug(districtSlug);
  if (!district) notFound();
  const school = await getSchoolBySlug(district.id, schoolSlug);
  if (!school) notFound();

  const user = await getSessionUser();
  const isAdmin = user?.role === "superadmin";
  const basePath = `/${district.slug}/${school.slug}`;

  const [inv, neighborsRaw, reachability] = await Promise.all([
    getInventoryForSchool(school.id),
    listNeighborsForSchool(school.id),
    listReachabilityForSchool(school.id),
  ]);
  const neighbors: NeighborLink[] = neighborsRaw.map((n) => ({
    id: n.id,
    localPort: n.localPort,
    systemName: n.systemName,
    chassisId: n.chassisId,
    systemDescription: n.systemDescription,
    portId: n.portId,
    portDescription: n.portDescription,
    mgmtIp: n.mgmtIp,
    vlanId: n.vlanId,
    protocol: n.protocol,
  }));

  const gaps = inv.rows
    .filter((r) => r.snmp === "gap")
    .map((r) => ({ key: r.key, name: r.name, ip: r.ip, vendor: r.vendor }));

  // Admin-only: the purge/restore surface + the school's SNMP-crawl switch.
  let excluded: ExcludedRow[] = [];
  let snmpCrawlEnabled = true;
  if (isAdmin) {
    [excluded, snmpCrawlEnabled] = await Promise.all([
      listExcludedForSchool(school.id),
      getSchoolSnmpEnabled(school.id),
    ]);
  }

  const initialTab = sp.tab === "links" ? "links" : "devices";
  const initialCategory =
    sp.type === "switch" || sp.type === "infra"
      ? "infra"
      : sp.type === "host" || sp.type === "endpoints"
        ? "endpoints"
        : "all";
  const initialSource =
    sp.source === "manual" ? "manual" : sp.source === "discovered" ? "discovered" : "all";

  return (
    <div className="flex flex-col gap-6">
      <SchoolTabs districtSlug={district.slug} schoolSlug={school.slug} />
      <PageHeader
        title="Devices"
        description={`${school.name || titleizeSlug(school.slug)} · inventory, switches, hosts, registry & links`}
      />

      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <StatCard label="Devices" value={String(inv.total)} icon={Boxes} hint={`${inv.discovered} discovered · ${inv.manual} manual`} />
        <StatCard label="Online" value={String(inv.online)} icon={Wifi} />
        <StatCard label="Answering SNMP" value={String(inv.snmpResponding)} icon={Radio} tone="success" />
        <StatCard label="SNMP gaps" value={String(inv.snmpGaps)} icon={WifiOff} tone={inv.snmpGaps > 0 ? "warning" : "success"} />
      </div>

      <SnmpGapCard schoolId={school.id} basePath={basePath} gaps={gaps} isAdmin={isAdmin} />

      <DevicesHub
        rows={inv.rows}
        neighbors={neighbors}
        reachability={reachability}
        schoolId={school.id}
        basePath={basePath}
        isAdmin={isAdmin}
        excluded={excluded}
        snmpCrawlEnabled={snmpCrawlEnabled}
        initialTab={initialTab}
        initialCategory={initialCategory}
        initialSource={initialSource}
      />
    </div>
  );
}
