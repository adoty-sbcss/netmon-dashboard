import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/current-user";
import { getManagedTree } from "@/db/queries";
import { PageHeader } from "@/components/page-header";
import { DataManagement } from "./data-management";

export const metadata = { title: "Data management · NetMon Dashboard" };
export const dynamic = "force-dynamic";

export default async function DataManagementPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // Destructive control plane — superadmin only.
  if (user.role !== "superadmin") redirect("/");

  const tree = await getManagedTree();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Data management"
        description="Rename, delete, or purge collected data. Renaming is name-only — the slug stays the mapping key, so new bundles keep landing in the renamed area automatically."
      />
      <DataManagement tree={tree} />
    </div>
  );
}
