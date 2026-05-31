"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, ChevronRight, DatabaseZap, DownloadCloud, Network, School } from "lucide-react";

import type { NavTree } from "@/db/queries";
import { titleizeSlug } from "@/lib/format";
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
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from "@/components/ui/sidebar";

export function AppSidebar({
  tree,
  isAdmin = false,
}: {
  tree: NavTree[];
  isAdmin?: boolean;
}) {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Network className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">NetMon</span>
                  <span className="truncate text-xs text-muted-foreground">
                    Network Dashboard
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
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton
                        tooltip={d.name}
                        isActive={isDistrictActive}
                      >
                        <Building2 />
                        <span>{d.name}</span>
                        <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                      </SidebarMenuButton>
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
                  tooltip="Data management"
                  isActive={pathname === "/settings/data"}
                >
                  <Link href="/settings/data">
                    <DatabaseZap />
                    <span>Data management</span>
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
