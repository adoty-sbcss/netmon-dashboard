import Link from "next/link";
import { redirect } from "next/navigation";
import { Lock } from "lucide-react";

import { getNavTree } from "@/db/queries";
import { getSessionUser } from "@/lib/auth/current-user";
import { getUserScope } from "@/lib/auth/scope";
import { getBranding } from "@/lib/branding";
import { getAssistantIdentity } from "@/lib/ai/settings";
import { AppSidebar } from "@/components/app-sidebar";
import { AiAssistantWidget } from "@/components/ai-chat/assistant-widget";
import { DynamicBreadcrumb } from "@/components/dynamic-breadcrumb";
import { GlobalSearch } from "@/components/global-search";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

// Live data: render on each request rather than freezing at build time.
export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Defense in depth: middleware already gates these routes, but never render
  // the dashboard without a verified session loaded from the DB.
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/account/change-password");

  const scope = await getUserScope(user);
  // These three are mutually independent; load them concurrently rather than
  // stacking their latencies on every page navigation.
  const [tree, b, assistant] = await Promise.all([
    getNavTree({ districtIds: scope.all ? null : scope.districtIds }),
    getBranding(),
    getAssistantIdentity(),
  ]);

  return (
    <SidebarProvider>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 bg-gradient-to-r from-[var(--brand-b)] via-primary to-[var(--brand-a)]"
      />
      <AppSidebar
        tree={tree}
        isAdmin={user.role === "superadmin"}
        branding={{
          appName: b.appName,
          tagline: b.tagline,
          hasLogo: b.hasLogo,
          version: b.version,
        }}
      />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <DynamicBreadcrumb tree={tree} />
          <div className="ml-auto flex items-center gap-2">
            <GlobalSearch />
            <ThemeToggle />
            <UserMenu email={user.email} role={user.role} />
          </div>
        </header>
        <main className="flex flex-1 flex-col gap-4 bg-muted/30 p-4 md:gap-6 md:p-6">
          {children}
        </main>
        <footer className="flex flex-col items-center justify-between gap-2 border-t bg-background px-4 py-3 text-xs text-muted-foreground sm:flex-row md:px-6 lg:pr-32">
          <p>
            © {new Date().getFullYear()} San Bernardino County Superintendent of Schools
          </p>
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <Lock className="size-3" />
              Secure connection
            </span>
            <Link href="/help" className="transition-colors hover:text-foreground">
              Help center
            </Link>
            <span className="font-heading font-medium text-foreground/70">{b.appName}</span>
          </div>
        </footer>
        <AiAssistantWidget name={assistant.name} greeting={assistant.greeting} hasAvatar={assistant.hasAvatar} />
      </SidebarInset>
    </SidebarProvider>
  );
}
