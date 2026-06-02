import { redirect } from "next/navigation";

// Consolidated into the Devices hub (Inventory tab). Add/import/edit live under
// /registry/* and are reached from the Devices hub.
export default async function RegistryRedirect({
  params,
}: {
  params: Promise<{ district: string; school: string }>;
}) {
  const { district, school } = await params;
  redirect(`/${district}/${school}/inventory?source=manual`);
}
