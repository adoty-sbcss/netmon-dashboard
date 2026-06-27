import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { InfoTip } from "@/components/info-tip";

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  info,
  tone = "default",
  className,
  href,
}: {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  hint?: string;
  /** Optional "what's this?" tooltip beside the label. Only shown on non-linked
   *  cards — a tooltip button can't legally nest inside the card's link. */
  info?: React.ReactNode;
  tone?: "default" | "success" | "warning" | "destructive" | "info";
  className?: string;
  /** When set, the whole card becomes a link. */
  href?: string;
}) {
  const toneRing: Record<string, string> = {
    default: "text-primary",
    success: "text-[var(--success)]",
    warning: "text-[var(--warning)]",
    destructive: "text-destructive",
    info: "text-[var(--info)]",
  };
  // A thin status-colored left edge + a tinted icon chip — keeps the slate base
  // but gives each tile a touch of color (neutral tiles read as brand blue).
  const toneBorder: Record<string, string> = {
    default: "border-l-primary/60",
    success: "border-l-[var(--success)]",
    warning: "border-l-[var(--warning)]",
    destructive: "border-l-destructive",
    info: "border-l-[var(--info)]",
  };
  const toneIconBg: Record<string, string> = {
    default: "bg-primary/10",
    success: "bg-[var(--success)]/10",
    warning: "bg-[var(--warning)]/10",
    destructive: "bg-destructive/10",
    info: "bg-[var(--info)]/10",
  };

  const card = (
    <Card
      className={cn(
        "gap-0 border-l-4 py-0",
        toneBorder[tone],
        href &&
          "h-full transition-all duration-200 ease-out hover:-translate-y-0.5 hover:bg-accent/40 hover:shadow-md",
        className,
      )}
    >
      <CardContent className="flex items-start justify-between gap-3 p-4 md:p-5">
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            {label}
            {info != null && !href && <InfoTip content={info} />}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
            {value}
          </p>
          {hint && (
            <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>
          )}
        </div>
        {Icon && (
          <div className={cn("shrink-0 rounded-lg p-2", toneIconBg[tone])}>
            <Icon className={cn("size-5", toneRing[tone])} />
          </div>
        )}
      </CardContent>
    </Card>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {card}
      </Link>
    );
  }
  return card;
}
