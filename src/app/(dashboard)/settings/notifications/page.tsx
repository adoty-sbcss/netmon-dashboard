import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/current-user";
import { PageHeader } from "@/components/page-header";
import { getNotificationConfig, listRecipients } from "@/lib/notifications/settings";
import { emailConfigured } from "@/lib/email";
import { NotificationsForm } from "./notifications-form";

export const metadata = { title: "Notifications · NetMon Dashboard" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "superadmin") redirect("/");

  const [config, recipients] = await Promise.all([
    getNotificationConfig(),
    listRecipients(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notifications"
        description="Email recipients, alert rules, and the monthly administrative summary."
      />
      <NotificationsForm
        config={config}
        recipients={recipients}
        emailConfigured={emailConfigured()}
      />
    </div>
  );
}
