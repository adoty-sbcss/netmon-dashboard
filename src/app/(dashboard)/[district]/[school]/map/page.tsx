import { notFound, redirect } from "next/navigation";

import {
  getDistrictBySlug,
  getSchoolBySlug,
  getSchoolMap,
} from "@/db/queries";
import { getInventoryForSchool } from "@/lib/inventory/queries";
import { getSessionUser } from "@/lib/auth/current-user";
import { getLatestTopologyRun } from "@/lib/ai/queries";
import { PageHeader } from "@/components/page-header";
import { SchoolTabs } from "@/components/school-tabs";
import { CytoscapePhysicalMap } from "@/components/topology/cytoscape-physical-map";
import { TopologyAiPanel } from "@/components/topology/topology-ai-panel";

export const dynamic = "force-dynamic";

export default async function MapPage({
  params,
}: {
  params: Promise<{ district: string; school: string }>;
}) {
  const { district: districtSlug, school: schoolSlug } = await params;

  const user = await getSessionUser();
  if (!user) redirect("/login");

  const district = await getDistrictBySlug(districtSlug);
  if (!district) notFound();
  const school = await getSchoolBySlug(district.id, schoolSlug);
  if (!school) notFound();

  const [map, topoRun, inv] = await Promise.all([
    getSchoolMap(school.id),
    getLatestTopologyRun(district.id, school.id),
    getInventoryForSchool(school.id),
  ]);
  const basePath = `/${district.slug}/${school.slug}`;

  // Status overlay for the map nodes, keyed by `${entityKind}:${entityId}`.
  const status: Record<string, string> = {};
  for (const r of inv.rows) {
    const key = r.switchId ? `switch:${r.switchId}` : r.hostId ? `host:${r.hostId}` : null;
    if (!key) continue;
    status[key] =
      r.snmp === "responding" ? "snmp" : r.snmp === "gap" ? "gap" : r.online ? "online" : "offline";
  }

  return (
    <div className="flex flex-col gap-6">
      <SchoolTabs districtSlug={district.slug} schoolSlug={school.slug} />
      <PageHeader
        title="Network map"
        description={`${district.name} · physical topology (LLDP/CDP backbone + bridge-table device attachment)`}
      />

      <CytoscapePhysicalMap
        graph={map.physical}
        basePath={basePath}
        status={status}
        schoolId={school.id}
        canSave={user.role === "superadmin"}
      />

      <TopologyAiPanel
        districtSlug={district.slug}
        schoolSlug={school.slug}
        canRun={user.role === "superadmin"}
        initialRun={topoRun}
      />
    </div>
  );
}
