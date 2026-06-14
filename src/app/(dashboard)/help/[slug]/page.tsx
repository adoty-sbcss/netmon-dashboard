import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ChevronRight, Wrench } from "lucide-react";

import { getSessionUser } from "@/lib/auth/current-user";
import { HELP_ARTICLES, getArticle } from "@/lib/help/articles";
import { PageHeader } from "@/components/page-header";
import { HelpArticleView } from "@/components/help/help-article-view";
import { ArticleFeedback } from "@/components/help/article-feedback";

export function generateStaticParams() {
  return HELP_ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getArticle(slug);
  return { title: article ? `${article.title} · Help` : "Help · NetMon Dashboard" };
}

export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) notFound();

  const updated = new Date(article.updated).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const isFix = (article.kind ?? "guide") === "fix";
  const related = HELP_ARTICLES.filter(
    (a) => a.category === article.category && a.slug !== article.slug,
  ).slice(0, 4);

  return (
    <div className="flex flex-col gap-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/help" className="inline-flex items-center gap-1.5 transition hover:text-foreground">
          <ArrowLeft className="size-4" /> Help center
        </Link>
        <ChevronRight className="size-3.5" />
        <span>{article.category}</span>
      </div>

      <PageHeader title={article.title} description={article.summary} />
      <div className="-mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        {isFix && (
          <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-amber-700 bg-amber-500/10 dark:text-amber-400">
            <Wrench className="size-3" /> Troubleshooting
          </span>
        )}
        <span>Updated {updated}</span>
      </div>

      <HelpArticleView article={article} />

      {/* Related */}
      {related.length > 0 && (
        <div className="mt-6 max-w-3xl border-t pt-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Related — {article.category}
          </p>
          <ul className="flex flex-col gap-1.5">
            {related.map((r) => (
              <li key={r.slug}>
                <Link
                  href={`/help/${r.slug}`}
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <ChevronRight className="size-3.5" /> {r.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ArticleFeedback slug={article.slug} />

      <p className="max-w-3xl pt-2 text-xs text-muted-foreground">
        Still stuck? Use the AI assistant (bottom-right) or contact your NetMon administrator.
      </p>
    </div>
  );
}
