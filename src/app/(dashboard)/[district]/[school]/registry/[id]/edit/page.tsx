import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getDistrictBySlug, getSchoolBySlug } from "@/db/queries";
import {
  getRegistryDevice,
  getRegistrySnmpCommunity,
} from "@/lib/registry/queries";
import { getSessionUser } from "@/lib/auth/current-user";
import { deviceTypeLabel } from "@/lib/registry/types";
import { PageHeader } from "@/components/page-header";
import { RegistryForm } from "../../registry-form";
import { RegistryDangerZone } from "./registry-danger-zone";

export const dynamic = "force-dynamic";

export default async function EditRegistryDevicePage({
  params,
}: {
  params: Promise<{ district: string; school: string; id: string }>;
}) {
  const { district: districtSlug, school: schoolSlug, id } = await params;
  const district = await getDistrictBySlug(districtSlug);
  if (!district) notFound();
  const school = await getSchoolBySlug(district.id, schoolSlug);
  if (!school) notFound();

  const user = await getSessionUser();
  if (user?.role !== "superadmin") redirect(`/${district.slug}/${school.slug}/registry`);

  const deviceId = Number.parseInt(id, 10);
  if (Number.isNaN(deviceId)) notFound();
  const device = await getRegistryDevice(deviceId);
  // Guard the device belongs to this school's district.
  if (!device || device.districtId !== district.id) notFound();

  const snmpCommunity = device.hasSnmpCommunity
    ? await getRegistrySnmpCommunity(deviceId)
    : null;
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
          title={device.name}
          description={`${deviceTypeLabel(device.deviceType, device.deviceTypeOther)} · ${district.name}`}
        />
      </div>

      <RegistryForm
        districtId={district.id}
        schoolId={device.schoolId}
        basePath={basePath}
        device={device}
        snmpCommunity={snmpCommunity}
      />

      <div className="max-w-2xl">
        <RegistryDangerZone
          deviceId={device.id}
          basePath={basePath}
          retired={device.status === "retired"}
        />
      </div>
    </div>
  );
}
