import { redirect } from "next/navigation";

// SFTP credential rotation moved onto the per-district settings page (each
// district has its own SFTP destination — there is no fleet-wide account). Kept
// as a redirect so old links/bookmarks land in the right place.
export default function SftpRotationRedirect() {
  redirect("/settings/network");
}
