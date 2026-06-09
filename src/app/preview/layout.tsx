/**
 * DEV-ONLY design harness. Renders the real app shell (sidebar + header +
 * footer) with mock data so the internal pages can be reviewed and screenshotted
 * without the VNet-private database. 404s in production; the proxy also only
 * lets /preview through when NODE_ENV !== "production".
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock } from "lucide-react";

import type { NavTree } from "@/db/queries";
import { AppSidebar } from "@/components/app-sidebar";
import { GlobalSearch } from "@/components/global-search";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

export const dynamic = "force-dynamic";

const MOCK_TREE: NavTree[] = [
  {
    id: 1,
    slug: "sbcss",
    name: "San Bernardino CSS",
    schools: [
      { id: 1, slug: "north-elementary", name: "North Elementary" },
      { id: 2, slug: "valley-high", name: "Valley High School" },
    ],
  },
  {
    id: 2,
    slug: "bear-valley-usd",
    name: "Bear Valley USD",
    schools: [{ id: 3, slug: "fallsvale", name: "Fallsvale Elementary" }],
  },
];

export default function PreviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <SidebarProvider>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 bg-gradient-to-r from-[var(--brand-b)] via-primary to-[var(--brand-a)]"
      />
      <AppSidebar
        tree={MOCK_TREE}
        isAdmin
        branding={{
          appName: "NetMon",
          tagline: "SBCSS Network Dashboard",
          hasLogo: false,
          version: 0,
        }}
      />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span>San Bernardino CSS</span>
            <span className="text-muted-foreground/50">/</span>
            <span className="font-medium text-foreground">North Elementary</span>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <GlobalSearch />
            <ThemeToggle />
            <UserMenu email="admin@sbcss.net" role="superadmin" />
          </div>
        </header>
        <main className="flex flex-1 flex-col gap-4 bg-muted/30 p-4 md:gap-6 md:p-6">
          {children}
        </main>
        <footer className="flex flex-col items-center justify-between gap-2 border-t bg-background px-4 py-3 text-xs text-muted-foreground sm:flex-row md:px-6 lg:pr-32">
          <p>© 2026 San Bernardino County Superintendent of Schools</p>
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <Lock className="size-3" />
              Secure connection
            </span>
            <Link href="/help" className="transition-colors hover:text-foreground">
              Help center
            </Link>
            <span className="font-heading font-medium text-foreground/70">NetMon</span>
          </div>
        </footer>
      </SidebarInset>
    </SidebarProvider>
  );
}
