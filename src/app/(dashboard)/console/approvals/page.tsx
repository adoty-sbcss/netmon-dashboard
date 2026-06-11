import { redirect } from "next/navigation";
import { Terminal } from "lucide-react";

import { getSessionUser } from "@/lib/auth/current-user";
import { listPendingConsoleApprovals } from "@/db/settings-queries";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApprovalsList } from "./approvals-list";

export const metadata = { title: "Console approvals · NetMon Dashboard" };
export const dynamic = "force-dynamic";

export default async function ConsoleApprovalsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "superadmin") redirect("/");

  const pending = await listPendingConsoleApprovals();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Console approvals"
        description="Live remote-console (SSH-like) sessions waiting for a super-admin to approve. Approving lets the box connect on its next check-in."
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Terminal className="size-4 text-primary" /> Pending requests
            {pending.length > 0 && (
              <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                {pending.length}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ApprovalsList items={pending} />
        </CardContent>
      </Card>
    </div>
  );
}
