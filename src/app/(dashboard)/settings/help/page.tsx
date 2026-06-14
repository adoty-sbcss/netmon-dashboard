import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Search, ThumbsDown } from "lucide-react";

import { getSessionUser } from "@/lib/auth/current-user";
import { getHelpInsights } from "@/lib/help/actions";
import { getArticle } from "@/lib/help/articles";
import { relativeTime } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Help feedback · NetMon Dashboard" };
export const dynamic = "force-dynamic";

export default async function HelpInsightsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "superadmin") redirect("/help");

  const insights = await getHelpInsights();
  if ("error" in insights) redirect("/help");
  const { searchMisses, unhelpful, byArticle } = insights;

  return (
    <div className="flex flex-col gap-6">
      <Link href="/help" className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Help center
      </Link>
      <PageHeader
        title="Help feedback"
        description="What people search for but don't find, and which articles aren't landing — your backlog of what to write or fix next (last 90 days)."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Search className="size-4 text-primary" /> Searches with no results
            <span className="text-xs font-normal text-muted-foreground">most frequent first</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {searchMisses.length === 0 ? (
            <p className="text-sm text-muted-foreground">No empty searches recorded yet.</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-sm">
              {searchMisses.map((m) => (
                <li key={m.query} className="flex items-center justify-between gap-3 border-b py-1 last:border-0">
                  <span className="font-mono">{m.query}</span>
                  <span className="shrink-0 text-muted-foreground">{m.count}×</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ThumbsDown className="size-4 text-primary" /> Articles marked not helpful
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {byArticle.length === 0 ? (
            <p className="text-sm text-muted-foreground">No thumbs-down votes yet.</p>
          ) : (
            <div className="flex flex-col gap-1.5 text-sm">
              {byArticle.map((a) => {
                const art = getArticle(a.slug);
                return (
                  <div key={a.slug} className="flex items-center justify-between gap-3 border-b py-1 last:border-0">
                    <Link href={`/help/${a.slug}`} className="text-primary hover:underline">
                      {art?.title ?? a.slug}
                    </Link>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      <span className="text-emerald-600">{a.helpful}↑</span>{" "}
                      <span className="text-destructive">{a.unhelpful}↓</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {unhelpful.some((u) => u.note) && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</p>
              {unhelpful
                .filter((u) => u.note)
                .map((u, i) => (
                  <div key={i} className="rounded-lg border bg-muted/30 p-2.5 text-sm">
                    <p className="text-xs text-muted-foreground">
                      {getArticle(u.slug ?? "")?.title ?? u.slug ?? "—"} · {relativeTime(u.at)}
                    </p>
                    <p className="mt-0.5">{u.note}</p>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
