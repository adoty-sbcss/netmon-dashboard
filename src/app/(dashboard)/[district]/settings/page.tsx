import { notFound, redirect } from "next/navigation";

import { getDistrictBySlug } from "@/db/queries";
import { getSessionUser } from "@/lib/auth/current-user";
import { getUserScope, scopeAllowsDistrict } from "@/lib/auth/scope";
import { listAuthorizedDhcpServers } from "@/lib/dhcp-policy";
import { getDistrictIperf } from "@/lib/iperf";
import { titleizeSlug } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { DhcpServersManager } from "./dhcp-servers-manager";
import { IperfServerForm } from "./iperf-server-form";

export const metadata = { title: "District settings" };
export const dynamic = "force-dynamic";

export default async function DistrictSettingsPage({
  params,
}: {
  params: Promise<{ district: string }>;
}) {
  const { district: districtSlug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const district = await getDistrictBySlug(districtSlug);
  if (!district) notFound();
  const scope = await getUserScope(user);
  if (!scopeAllowsDistrict(scope, district.id)) redirect(`/${district.slug}`);

  const [servers, iperf] = await Promise.all([
    listAuthorizedDhcpServers(district.id),
    getDistrictIperf(district.id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="District settings"
        description={`${
          district.name || titleizeSlug(district.slug)
        } — network policy that tunes alerts and AI reports.`}
      />
      <DhcpServersManager districtSlug={district.slug} servers={servers} />
      <IperfServerForm districtSlug={district.slug} iperf={iperf} />
    </div>
  );
}
