import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/current-user";
import { HELP_ARTICLES, articleMeta } from "@/lib/help/articles";
import { PageHeader } from "@/components/page-header";
import { HelpBrowser } from "@/components/help/help-browser";

export const metadata = { title: "Help · NetMon Dashboard" };

// Category display order (anything new appears after these, in first-seen order).
const CATEGORY_ORDER = ["Sensors", "Monitoring", "Settings"];

export default async function HelpIndexPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const articles = HELP_ARTICLES.map(articleMeta).sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a.category);
    const bi = CATEGORY_ORDER.indexOf(b.category);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Help center"
        description="Search for your issue, or browse the guides below. Each one is short, with clear steps and copy-able commands."
      />
      {articles.length === 0 ? (
        <p className="text-sm text-muted-foreground">No articles yet.</p>
      ) : (
        <HelpBrowser articles={articles} />
      )}
    </div>
  );
}
