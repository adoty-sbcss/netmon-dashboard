import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { getSessionUser } from "@/lib/auth/current-user";
import { getIngestSettingsView, resolveSftpConfig } from "@/lib/ingest/settings";
import { getEnrollmentView } from "@/lib/sensor/enrollment";
import { PageHeader } from "@/components/page-header";
import { IngestionSettingsForm } from "./ingestion-settings-form";
import { EnrollmentSettings } from "./enrollment-settings";

export const metadata = { title: "Ingestion settings · NetMon Dashboard" };
export const dynamic = "force-dynamic";

export default async function IngestionSettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // Admin-only control plane. Non-admins are bounced to the dashboard root.
  if (user.role !== "superadmin") redirect("/");

  const [settings, enrollment, sftpResolved] = await Promise.all([
    getIngestSettingsView(),
    getEnrollmentView(),
    resolveSftpConfig(),
  ]);

  // Sensors push to the SAME SFTP drop the dashboard pulls from, so we bake the
  // stored ingestion creds straight into the provisioning snippet. Password may
  // be absent if the drop is configured with key auth (sensors use password
  // auth, so the snippet flags that case). null when SFTP isn't configured yet.
  const sftpProvision = sftpResolved.config
    ? {
        host: sftpResolved.config.host,
        port: sftpResolved.config.port,
        user: sftpResolved.config.username,
        password: sftpResolved.config.password ?? null,
        remotePath: sftpResolved.config.baseDir || "/",
      }
    : null;

  // Public origin for the netmon.env snippet (pinned via APP_ORIGIN, else host).
  let appOrigin = (process.env.APP_ORIGIN ?? "").replace(/\/$/, "");
  if (!appOrigin) {
    const h = await headers();
    const host = h.get("x-forwarded-host") || h.get("host");
    const proto = h.get("x-forwarded-proto") || "https";
    appOrigin = host ? `${proto}://${host}` : "https://<your-app-host>";
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="SFTP ingestion"
        description="Connect to the NetMon SFTP drop, pull new bundles, and load them into the dashboard. Credentials are encrypted at rest."
      />
      <IngestionSettingsForm settings={settings} />
      <EnrollmentSettings
        enrollment={enrollment}
        appOrigin={appOrigin}
        sftp={sftpProvision}
      />
    </div>
  );
}
