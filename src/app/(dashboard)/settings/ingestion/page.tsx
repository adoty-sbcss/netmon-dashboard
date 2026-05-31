import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/current-user";
import { getIngestSettingsView } from "@/lib/ingest/settings";
import { PageHeader } from "@/components/page-header";
import { IngestionSettingsForm } from "./ingestion-settings-form";

export const metadata = { title: "Ingestion settings · NetMon Dashboard" };
export const dynamic = "force-dynamic";

export default async function IngestionSettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // Admin-only control plane. Non-admins are bounced to the dashboard root.
  if (user.role !== "superadmin") redirect("/");

  const settings = await getIngestSettingsView();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="SFTP ingestion"
        description="Connect to the NetMon SFTP drop, pull new bundles, and load them into the dashboard. Credentials are encrypted at rest."
      />
      <IngestionSettingsForm settings={settings} />
    </div>
  );
}
