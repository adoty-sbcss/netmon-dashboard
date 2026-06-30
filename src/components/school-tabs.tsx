"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes,
  Gauge,
  Globe,
  HardDrive,
  LayoutDashboard,
  Map as MapIcon,
  Radio,
  Sparkles,
  Wifi,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Secondary navigation shown on a school's overview and all of its sub-pages.
 * Makes the sibling views (map, switches, hosts, DHCP, …) reachable in one
 * click instead of routing back up to the school overview to click a card.
 *
 * Rendered on the school-level pages only — entity detail pages (host/[id],
 * switch/[id], sensor/[id]) sit a level deeper and keep their own back-link.
 */
const TABS: { label: string; seg: string; icon: LucideIcon }[] = [
  { label: "Overview", seg: "", icon: LayoutDashboard },
  { label: "Network map", seg: "map", icon: MapIcon },
  { label: "Devices", seg: "inventory", icon: Boxes },
  { label: "DHCP", seg: "dhcp", icon: HardDrive },
  { label: "DNS", seg: "dns", icon: Globe },
  { label: "Wireless", seg: "wireless", icon: Wifi },
  { label: "Speed & Bandwidth", seg: "iperf", icon: Gauge },
  { label: "Sensors", seg: "sensors", icon: Radio },
  { label: "AI analysis", seg: "ai", icon: Sparkles },
];

export function SchoolTabs({
  districtSlug,
  schoolSlug,
}: {
  districtSlug: string;
  schoolSlug: string;
}) {
  const pathname = usePathname();
  const base = `/${districtSlug}/${schoolSlug}`;

  // The segment immediately after the school base ("" on the overview itself).
  const rest = pathname.startsWith(base)
    ? pathname.slice(base.length).replace(/^\//, "")
    : "";
  const activeSeg = rest.split("/")[0];

  return (
    <nav
      aria-label="School sections"
      className="flex gap-3 overflow-x-auto border-b sm:gap-5"
    >
      {TABS.map((t) => {
        const active = activeSeg === t.seg;
        const Icon = t.icon;
        return (
          <Link
            key={t.seg}
            href={t.seg ? `${base}/${t.seg}` : base}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-1 pb-2.5 text-sm font-medium transition-colors",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
