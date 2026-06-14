"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ChevronRight,
  LifeBuoy,
  Radio,
  Search,
  SlidersHorizontal,
  Wrench,
} from "lucide-react";

import type { HelpArticleMeta } from "@/lib/help/articles";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

// Icon per category (falls back to LifeBuoy for anything new).
const CATEGORY_ICON: Record<string, typeof Radio> = {
  Sensors: Radio,
  Monitoring: Activity,
  Settings: SlidersHorizontal,
};

function matches(a: HelpArticleMeta, q: string): boolean {
  if (!q) return true;
  const hay = `${a.title} ${a.summary} ${a.category} ${a.keywords.join(" ")}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => hay.includes(term));
}

function KindBadge({ kind }: { kind: "fix" | "guide" }) {
  return kind === "fix" ? (
    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-amber-700 bg-amber-500/10 dark:text-amber-400">
      <Wrench className="size-3" /> Fix
    </span>
  ) : (
    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      Guide
    </span>
  );
}

function ArticleCard({ a, showCategory }: { a: HelpArticleMeta; showCategory?: boolean }) {
  return (
    <Link href={`/help/${a.slug}`} className="group">
      <Card className="h-full transition hover:border-primary/50 hover:shadow-sm">
        <CardContent className="flex h-full items-start justify-between gap-3 p-4">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium leading-tight">{a.title}</span>
              <KindBadge kind={a.kind} />
              {showCategory && (
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {a.category}
                </span>
              )}
            </div>
            <span className="text-sm text-muted-foreground">{a.summary}</span>
          </div>
          <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
        </CardContent>
      </Card>
    </Link>
  );
}

export function HelpBrowser({ articles }: { articles: HelpArticleMeta[] }) {
  const [q, setQ] = useState("");

  const featured = useMemo(() => articles.filter((a) => a.featured), [articles]);
  const filtered = useMemo(() => articles.filter((a) => matches(a, q)), [articles, q]);

  // Group filtered results by category, preserving the input order of categories.
  const groups = useMemo(() => {
    const m = new Map<string, HelpArticleMeta[]>();
    for (const a of filtered) {
      const list = m.get(a.category) ?? [];
      list.push(a);
      m.set(a.category, list);
    }
    return [...m.entries()];
  }, [filtered]);

  const searching = q.trim().length > 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Search — the fastest path to a specific issue. */}
      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search help — e.g. “no data”, “rogue DHCP”, “speed test”, “stuck”…"
          className="h-11 pl-9"
          autoFocus
        />
      </div>

      {/* Featured / important — only when not searching. */}
      {!searching && featured.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-3.5" /> Start here
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {featured.map((a) => (
              <Link key={a.slug} href={`/help/${a.slug}`} className="group">
                <Card className="h-full border-amber-500/40 bg-amber-500/[0.04] transition hover:border-amber-500/70 hover:shadow-sm">
                  <CardContent className="flex h-full items-start justify-between gap-3 p-4">
                    <div className="flex min-w-0 flex-col gap-1">
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
      )}

      {/* Results */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center">
          <LifeBuoy className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">No articles match “{q}”.</p>
          <p className="text-sm text-muted-foreground">
            Try fewer or different words, or clear the search to browse all topics.
          </p>
        </div>
      ) : searching ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {filtered.length} result{filtered.length === 1 ? "" : "s"}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {filtered.map((a) => (
              <ArticleCard key={a.slug} a={a} showCategory />
            ))}
          </div>
        </section>
      ) : (
        groups.map(([category, list]) => {
          const Icon = CATEGORY_ICON[category] ?? LifeBuoy;
          return (
            <section key={category} className="flex flex-col gap-3">
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Icon className="size-3.5" /> {category}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {list.map((a) => (
                  <ArticleCard key={a.slug} a={a} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
