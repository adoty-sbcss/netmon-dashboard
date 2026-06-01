import { notFound, redirect } from "next/navigation";

import {
  getDistrictBySlug,
  getSchoolBySlug,
  getSchoolMap,
} from "@/db/queries";
import { getSessionUser } from "@/lib/auth/current-user";
import { PageHeader } from "@/components/page-header";
import { SchoolTabs } from "@/components/school-tabs";
import { NetworkMap } from "@/components/network-map";

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

  const map = await getSchoolMap(school.id);
  const basePath = `/${district.slug}/${school.slug}`;

  return (
    <div className="flex flex-col gap-6">
      <SchoolTabs districtSlug={district.slug} schoolSlug={school.slug} />
      <PageHeader
        title="Network map"
        description={`${district.name} · physical (LLDP/CDP) and logical (subnet/gateway) topology`}
      />

      <NetworkMap
        physical={map.physical}
        logical={map.logical}
        basePath={basePath}
        schoolId={school.id}
        canSave={user.role === "superadmin"}
      />
    </div>
  );
}
