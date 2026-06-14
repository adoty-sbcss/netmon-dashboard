"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import type { NavTree } from "@/db/queries";
import { prettySegment, titleizeSlug } from "@/lib/format";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

type Crumb = { label: string; href?: string };

// Admin settings section — labels mirror the sidebar's "Administration" group.
const SETTINGS_LABELS: Record<string, string> = {
  network: "School & district settings",
  ingestion: "SFTP ingestion",
  ai: "AI settings",
  branding: "Branding",
  data: "Data management",
  users: "Users",
};

// District-scoped page segments → friendly labels (acronyms cased correctly).
const DISTRICT_LABELS: Record<string, string> = {
  ai: "AI analysis",
  map: "Network map",
  switches: "Switches",
  hosts: "Hosts",
  neighbors: "Neighbors",
  dhcp: "DHCP",
  dns: "DNS",
  findings: "Findings",
  sensors: "Sensors",
  settings: "Settings",
};

// Entity-detail containers that have NO index route (e.g. /sensor/5). We render
// them as a single non-link crumb and absorb the id that follows, since the
// detail page's own header + back-link already carry the entity's real name.
const CONTAINERS: Record<string, string> = {
  sensor: "Sensor",
  host: "Host",
  switch: "Switch",
};

export function DynamicBreadcrumb({ tree }: { tree: NavTree[] }) {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  const crumbs: Crumb[] = [];

  if (segments[0] === "settings") {
    // /settings/* — there is no /settings index, so the root is a plain label.
    crumbs.push({ label: "Settings" });
    if (segments[1]) {
      crumbs.push({
        label: SETTINGS_LABELS[segments[1]] ?? prettySegment(segments[1]),
      });
    }
  } else if (segments.length > 0) {
    // /[district]/[school]/...
    const districtSlug = segments[0];
    const schoolSlug = segments[1];
    const district = tree.find((d) => d.slug === districtSlug);
    const school = district?.schools.find((s) => s.slug === schoolSlug);

    crumbs.push({
      label: district?.name ?? prettySegment(districtSlug),
      href: `/${districtSlug}`,
    });

    if (schoolSlug) {
      // Depth-2 under a district is either a real school or a district
      // aggregate/page (hosts, findings, ai, settings, …) — resolve both.
      const label = school
        ? (school.name ?? titleizeSlug(schoolSlug))
        : (DISTRICT_LABELS[schoolSlug] ?? prettySegment(schoolSlug));
      crumbs.push({ label, href: `/${districtSlug}/${schoolSlug}` });
    }

    for (let i = 2; i < segments.length; i++) {
      const seg = segments[i];
      if (CONTAINERS[seg]) {
        crumbs.push({ label: CONTAINERS[seg] }); // non-link; absorbs the id
        i++; // skip the bare id segment
        continue;
      }
      crumbs.push({
        label: DISTRICT_LABELS[seg] ?? prettySegment(seg),
        href: "/" + segments.slice(0, i + 1).join("/"),
      });
    }
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
        {crumbs.map((c, idx) => {
          const isLast = idx === crumbs.length - 1;
          return (
            <React.Fragment key={`${c.label}-${idx}`}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{c.label}</BreadcrumbPage>
                ) : c.href ? (
                  <BreadcrumbLink asChild>
                    <Link href={c.href}>{c.label}</Link>
                  </BreadcrumbLink>
                ) : (
                  // Non-navigable intermediate (e.g. the "Settings" root).
                  <span className="font-normal text-muted-foreground">
                    {c.label}
                  </span>
                )}
              </BreadcrumbItem>
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
