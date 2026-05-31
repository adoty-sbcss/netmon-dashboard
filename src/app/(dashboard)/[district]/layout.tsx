import { notFound, redirect } from "next/navigation";

import { getDistrictBySlug } from "@/db/queries";
import { getSessionUser } from "@/lib/auth/current-user";
import { getUserScope, scopeAllowsDistrict } from "@/lib/auth/scope";

export const dynamic = "force-dynamic";

/**
 * Authorization chokepoint for everything under /[district]/*. A user may only
 * enter a district they're granted (superadmins are granted all). Unauthorized
 * access 404s rather than revealing the district exists.
 */
export default async function DistrictLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ district: string }>;
}) {
  const { district: slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const district = await getDistrictBySlug(slug);
  if (!district) notFound();

  const scope = await getUserScope(user);
  if (!scopeAllowsDistrict(scope, district.id)) notFound();

  return <>{children}</>;
}
