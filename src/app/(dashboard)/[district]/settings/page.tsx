import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * District settings were consolidated into the single global Network settings
 * page (/settings/network). This route now redirects there, pre-selecting the
 * district, so old links/bookmarks still land in the right place.
 *
 * The DhcpServersManager + IperfServerForm components in this folder are still
 * imported by /settings/network — only this route page became a redirect.
 */
export default async function DistrictSettingsRedirect({
  params,
}: {
  params: Promise<{ district: string }>;
}) {
  const { district } = await params;
  redirect(`/settings/network?district=${district}`);
}
