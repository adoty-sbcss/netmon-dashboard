import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getDistrictBySlug, getSchoolBySlug } from "@/db/queries";
import { getSessionUser } from "@/lib/auth/current-user";
import { titleizeSlug } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { RegistryForm } from "../registry-form";

export const dynamic = "force-dynamic";

export default async function NewRegistryDevicePage({
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
  if (user?.role !== "superadmin") redirect(`/${district.slug}/${school.slug}/registry`);

  const basePath = `/${district.slug}/${school.slug}`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`${basePath}/registry`}
          className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Equipment registry
        </Link>
        <PageHeader
          title="Add device"
          description={`${school.name || titleizeSlug(school.slug)} · ${district.name}`}
        />
      </div>
      <RegistryForm districtId={district.id} schoolId={school.id} basePath={basePath} />
    </div>
  );
}
