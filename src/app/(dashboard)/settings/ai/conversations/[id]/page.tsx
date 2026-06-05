import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getSessionUser } from "@/lib/auth/current-user";
import { getConversationDetail } from "@/lib/ai/chat-queries";
import { dateTime } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "superadmin") redirect("/");

  const { id } = await params;
  const conv = await getConversationDetail(Number(id));
  if (!conv) notFound();

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/settings/ai/conversations"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> All conversations
      </Link>

      <PageHeader
        title={conv.userName || conv.userEmail || "Conversation"}
        description={`${conv.districtName ?? "no district in view"} · started ${dateTime(
          conv.createdAt,
        )} · ${conv.messages.length} message(s)`}
      />

      <Card>
        <CardContent className="flex flex-col gap-3 py-4">
          {conv.messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No messages in this conversation.</p>
          ) : (
            conv.messages.map((m) => (
              <div
                key={m.id}
                className={m.role === "user" ? "max-w-[85%] self-end" : "max-w-[90%] self-start"}
              >
                <div
                  className={`whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "border bg-muted/40"
                  }`}
                >
                  {m.content}
                </div>
                <p
                  className={`mt-0.5 text-[10px] text-muted-foreground ${
                    m.role === "user" ? "text-right" : ""
                  }`}
                >
                  {m.role}
                  {m.model ? ` · ${m.model}` : ""} · {dateTime(m.createdAt)}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
