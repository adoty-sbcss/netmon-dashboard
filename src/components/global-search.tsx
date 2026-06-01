"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "radix-ui";
import {
  Building2,
  Cpu,
  Radio,
  School,
  Search,
  type LucideIcon,
} from "lucide-react";

import { globalSearch } from "@/lib/search";
import type { SearchHit, SearchResults } from "@/db/fleet-queries";
import { cn } from "@/lib/utils";

const EMPTY: SearchResults = {
  districts: [],
  schools: [],
  sensors: [],
  hosts: [],
};

const GROUPS: { key: keyof SearchResults; label: string; icon: LucideIcon }[] = [
  { key: "districts", label: "Districts", icon: Building2 },
  { key: "schools", label: "Schools", icon: School },
  { key: "sensors", label: "Sensors", icon: Radio },
  { key: "hosts", label: "Hosts", icon: Cpu },
];

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResults>(EMPTY);
  const [loading, setLoading] = React.useState(false);
  const [active, setActive] = React.useState(0);

  // Open/close with Ctrl/⌘-K from anywhere.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Debounced search. All state writes happen inside the async timeout (never
  // synchronously in the effect body) so a short/cleared query is handled by
  // deriving the view below rather than by clearing state here.
  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await globalSearch(q);
        if (!cancelled) {
          setResults(r);
          setActive(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  const tooShort = query.trim().length < 2;
  const view = tooShort ? EMPTY : results;
  const flat: SearchHit[] = GROUPS.flatMap((g) => view[g.key]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setQuery("");
      setActive(0);
    }
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const hit = flat[active];
      if (hit) {
        e.preventDefault();
        go(hit.href);
      }
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="Search"
          className="inline-flex h-9 items-center gap-2 rounded-lg border px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Search className="size-4" />
          <span className="hidden sm:inline">Search…</span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 supports-[backdrop-filter]:backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[12%] z-50 w-[92vw] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg"
        >
          <Dialog.Title className="sr-only">Search</Dialog.Title>
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Search districts, schools, sensors, hosts…"
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div className="max-h-[60vh] overflow-y-auto p-2">
            {tooShort ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                Type at least 2 characters to search by name or IP.
              </p>
            ) : loading && flat.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                Searching…
              </p>
            ) : flat.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                No matches for “{query.trim()}”.
              </p>
            ) : (
              GROUPS.map((g) => {
                const hits = view[g.key];
                if (hits.length === 0) return null;
                const Icon = g.icon;
                return (
                  <div key={g.key} className="mb-1">
                    <div className="px-3 py-1 text-xs font-medium text-muted-foreground">
                      {g.label}
                    </div>
                    {hits.map((h) => {
                      const i = flat.findIndex((f) => f.href === h.href);
                      const isActive = i === active;
                      return (
                        <button
                          key={h.href}
                          type="button"
                          onClick={() => go(h.href)}
                          onMouseMove={() => setActive(i)}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left",
                            isActive ? "bg-accent" : "hover:bg-accent/60",
                          )}
                        >
                          <Icon className="size-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {h.label}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {h.sublabel}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>

          <div className="flex items-center justify-between border-t px-3 py-2 text-[11px] text-muted-foreground">
            <span>↑↓ to navigate · ↵ to open</span>
            <span>
              <kbd className="rounded border bg-muted px-1 font-mono">Ctrl</kbd>
              {" / "}
              <kbd className="rounded border bg-muted px-1 font-mono">⌘</kbd> K
            </span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
