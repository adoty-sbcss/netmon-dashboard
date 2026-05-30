"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import type { NavTree } from "@/db/queries";
import { titleizeSlug } from "@/lib/format";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export function DynamicBreadcrumb({ tree }: { tree: NavTree[] }) {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  // Resolve slug → display name from the nav tree where possible.
  const districtSlug = segments[0];
  const schoolSlug = segments[1];
  const district = tree.find((d) => d.slug === districtSlug);
  const school = district?.schools.find((s) => s.slug === schoolSlug);

  const crumbs: { label: string; href: string; isLast: boolean }[] = [];
  if (districtSlug) {
    crumbs.push({
      label: district?.name ?? titleizeSlug(districtSlug),
      href: `/${districtSlug}`,
      isLast: segments.length === 1,
    });
  }
  if (schoolSlug) {
    crumbs.push({
      label: school?.name ?? titleizeSlug(schoolSlug),
      href: `/${districtSlug}/${schoolSlug}`,
      isLast: segments.length === 2,
    });
  }
  // Any deeper segments (e.g. sensor) rendered raw for now.
  for (let i = 2; i < segments.length; i++) {
    crumbs.push({
      label: titleizeSlug(segments[i]),
      href: "/" + segments.slice(0, i + 1).join("/"),
      isLast: i === segments.length - 1,
    });
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          {segments.length === 0 ? (
            <BreadcrumbPage>Overview</BreadcrumbPage>
          ) : (
            <BreadcrumbLink asChild>
              <Link href="/">Overview</Link>
            </BreadcrumbLink>
          )}
        </BreadcrumbItem>
        {crumbs.map((c) => (
          <React.Fragment key={c.href}>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              {c.isLast ? (
                <BreadcrumbPage>{c.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild>
                  <Link href={c.href}>{c.label}</Link>
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </React.Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
