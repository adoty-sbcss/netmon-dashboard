import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { getSessionUser } from "@/lib/auth/current-user";
import { HELP_ARTICLES } from "@/lib/help/articles";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "Help · NetMon Dashboard" };

export default async function HelpIndexPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // Group articles by category, preserving first-seen order.
  const byCategory = new Map<string, typeof HELP_ARTICLES>();
  for (const a of HELP_ARTICLES) {
    const list = byCategory.get(a.category) ?? [];
    list.push(a);
    byCategory.set(a.category, list);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Help center"
        description="Step-by-step guides for running and troubleshooting NetMon. Each guide has copy-able commands and screenshots."
      />

      {HELP_ARTICLES.length === 0 ? (
        <p className="text-sm text-muted-foreground">No articles yet.</p>
      ) : (
        [...byCategory.entries()].map(([category, articles]) => (
          <section key={category} className="flex flex-col gap-3">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {category}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {articles.map((a) => (
                <Link key={a.slug} href={`/help/${a.slug}`} className="group">
                  <Card className="h-full transition hover:border-primary/50 hover:shadow-sm">
                    <CardContent className="flex h-full items-start justify-between gap-3 p-4">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium leading-tight">{a.title}</span>
                        <span className="text-sm text-muted-foreground">{a.summary}</span>
                      </div>
                      <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
