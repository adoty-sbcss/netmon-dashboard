import { redirect } from "next/navigation";

// Consolidated into the Devices hub (Inventory tab → Links).
export default async function NeighborsRedirect({
  params,
}: {
  params: Promise<{ district: string; school: string }>;
}) {
  const { district, school } = await params;
  redirect(`/${district}/${school}/inventory?tab=links`);
}
