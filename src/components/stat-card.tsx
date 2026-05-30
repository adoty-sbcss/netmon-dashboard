import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  tone = "default",
  className,
  href,
}: {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  hint?: string;
  tone?: "default" | "success" | "warning" | "destructive" | "info";
  className?: string;
  /** When set, the whole card becomes a link. */
  href?: string;
}) {
  const toneRing: Record<string, string> = {
    default: "text-muted-foreground",
    success: "text-[var(--success)]",
    warning: "text-[var(--warning)]",
    destructive: "text-destructive",
    info: "text-[var(--info)]",
  };

  const card = (
    <Card
      className={cn(
        "gap-0 py-0",
        href && "h-full transition-colors hover:border-primary/40 hover:bg-accent/40",
        className,
      )}
    >
      <CardContent className="flex items-start justify-between gap-3 p-4 md:p-5">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
            {value}
          </p>
          {hint && (
            <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>
          )}
        </div>
        {Icon && (
          <div className="shrink-0 rounded-lg bg-muted p-2">
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
