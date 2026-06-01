"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, ChevronRight, DatabaseZap, DownloadCloud, Palette, Radio, School, Sparkles, Users } from "lucide-react";

import type { NavTree } from "@/db/queries";
import { titleizeSlug } from "@/lib/format";
import { BrandLogo } from "@/components/logo";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from "@/components/ui/sidebar";

export interface SidebarBranding {
  appName: string;
  tagline: string;
  hasLogo: boolean;
  version: number;
}

export function AppSidebar({
  tree,
  isAdmin = false,
  branding,
}: {
  tree: NavTree[];
  isAdmin?: boolean;
  branding: SidebarBranding;
}) {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <div className="flex aspect-square size-8 items-center justify-center">
                  {branding.hasLogo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/branding/logo?v=${branding.version}`}
                      alt={branding.appName}
                      className="size-8 object-contain"
                    />
                  ) : (
                    <BrandLogo className="size-8" />
                  )}
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{branding.appName}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {branding.tagline}
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Districts</SidebarGroupLabel>
          <SidebarMenu>
            {tree.length === 0 && (
              <SidebarMenuItem>
                <SidebarMenuButton disabled>
                  <Building2 />
                  <span className="text-muted-foreground">No districts yet</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            {tree.map((d) => {
              const districtHref = `/${d.slug}`;
              const isDistrictActive = pathname === districtHref;
              const hasActiveChild = pathname.startsWith(districtHref + "/");
              return (
                <Collapsible
                  key={d.id}
                  asChild
                  defaultOpen={isDistrictActive || hasActiveChild}
                  className="group/collapsible"
                >
                  <SidebarMenuItem>
                    {/* The label navigates to the district page... */}
                    <SidebarMenuButton
                      asChild
                      tooltip={d.name}
                      isActive={isDistrictActive}
                    >
                      <Link href={districtHref}>
                        <Building2 />
                        <span>{d.name}</span>
                      </Link>
                    </SidebarMenuButton>
                    {/* ...while a separate chevron expands/collapses the schools. */}
                    <CollapsibleTrigger asChild>
                      <SidebarMenuAction className="transition-transform duration-200 data-[state=open]:rotate-90">
                        <ChevronRight />
                        <span className="sr-only">Toggle schools</span>
                      </SidebarMenuAction>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {d.schools.length === 0 && (
                          <SidebarMenuSubItem>
                            <span className="px-2 text-xs text-muted-foreground">
                              No schools
                            </span>
                          </SidebarMenuSubItem>
                        )}
                        {d.schools.map((s) => {
                          const href = `/${d.slug}/${s.slug}`;
                          return (
                            <SidebarMenuSubItem key={s.id}>
                              <SidebarMenuSubButton
                                asChild
                                isActive={pathname === href}
                              >
                                <Link href={href}>
                                  <School className="size-3.5" />
                                  <span>{s.name ?? titleizeSlug(s.slug)}</span>
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          );
                        })}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Administration</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  tooltip="All sensors"
                  isActive={pathname === "/sensors"}
                >
                  <Link href="/sensors">
                    <Radio />
                    <span>Sensors</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  tooltip="SFTP ingestion"
                  isActive={pathname === "/settings/ingestion"}
                >
                  <Link href="/settings/ingestion">
                    <DownloadCloud />
                    <span>SFTP ingestion</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  tooltip="AI settings"
                  isActive={pathname === "/settings/ai"}
                >
                  <Link href="/settings/ai">
                    <Sparkles />
                    <span>AI settings</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  tooltip="Branding"
                  isActive={pathname === "/settings/branding"}
                >
                  <Link href="/settings/branding">
                    <Palette />
                    <span>Branding</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  tooltip="Data management"
                  isActive={pathname === "/settings/data"}
                >
                  <Link href="/settings/data">
                    <DatabaseZap />
                    <span>Data management</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  tooltip="Users"
                  isActive={pathname === "/settings/users"}
                >
                  <Link href="/settings/users">
                    <Users />
                    <span>Users</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
