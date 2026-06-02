import { redirect } from "next/navigation";

// Consolidated into the Devices hub (Inventory tab).
export default async function HostsRedirect({
  params,
}: {
  params: Promise<{ district: string; school: string }>;
}) {
  const { district, school } = await params;
  redirect(`/${district}/${school}/inventory?type=host`);
}
