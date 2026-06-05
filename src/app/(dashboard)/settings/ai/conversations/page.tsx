import Link from "next/link";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/current-user";
import { listConversations } from "@/lib/ai/chat-queries";
import { relativeTime } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "Assistant conversations · NetMon Dashboard" };
export const dynamic = "force-dynamic";

export default async function ConversationsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "superadmin") redirect("/");

  const conversations = await listConversations(100);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Assistant conversations"
        description="Recorded NetMon Assistant chats across all users (latest 100, most recent first)."
      />
      <Card>
        <CardContent className="p-0">
          {conversations.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No conversations recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="px-4 py-2 font-medium">User</th>
                    <th className="px-4 py-2 font-medium">District</th>
                    <th className="px-4 py-2 font-medium">First message</th>
                    <th className="px-4 py-2 font-medium">Msgs</th>
                    <th className="px-4 py-2 font-medium">Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {conversations.map((c) => (
                    <tr key={c.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-2">
                        <Link
                          href={`/settings/ai/conversations/${c.id}`}
                          className="font-medium hover:underline"
                        >
                          {c.userName || c.userEmail || "unknown user"}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{c.districtName ?? "—"}</td>
                      <td className="max-w-xs truncate px-4 py-2 text-muted-foreground">
                        {c.title ?? "—"}
                      </td>
                      <td className="px-4 py-2 tabular-nums">{c.messageCount}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {relativeTime(c.updatedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
