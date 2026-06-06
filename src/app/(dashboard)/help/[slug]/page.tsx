import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getSessionUser } from "@/lib/auth/current-user";
import { HELP_ARTICLES, getArticle } from "@/lib/help/articles";
import { PageHeader } from "@/components/page-header";
import { HelpArticleView } from "@/components/help/help-article-view";

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

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/help"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Help center
      </Link>
      <PageHeader title={article.title} description={article.summary} />
      <p className="-mt-2 text-xs text-muted-foreground">Updated {updated}</p>
      <HelpArticleView article={article} />
    </div>
  );
}
