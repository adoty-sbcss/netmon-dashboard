import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import {
  getDistrictBySlug,
  getSchoolBySlug,
  getSchoolTopology,
} from "@/db/queries";
import { titleizeSlug } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { NetworkMap } from "@/components/network-map";

export const dynamic = "force-dynamic";

export default async function MapPage({
  params,
}: {
  params: Promise<{ district: string; school: string }>;
}) {
  const { district: districtSlug, school: schoolSlug } = await params;

  const district = await getDistrictBySlug(districtSlug);
  if (!district) notFound();
  const school = await getSchoolBySlug(district.id, schoolSlug);
  if (!school) notFound();

  const topology = await getSchoolTopology(school.id);
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
          title="Network map"
          description={`${district.name} · physical (LLDP/CDP) and logical (subnet/gateway) topology`}
        />
      </div>

      <NetworkMap physical={topology.physical} logical={topology.logical} />
    </div>
  );
}
