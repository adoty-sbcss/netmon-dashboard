import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Soft blue "section band" header for the major cards on overview pages: a faint
 * --primary (brand blue) tint flush to the card's top edge + a larger blue title
 * + an icon. Makes stacked sections (AI analysis / Sensors / Deploy …) read as
 * distinct at a glance while staying on-brand.
 *
 * The Card has `py-4`, so `-mt-4` pulls the band flush to the rounded top edge;
 * `border-b` triggers the card-header's built-in `pb-4`, and `pt-4` restores the
 * top padding the negative margin cancels.
 */
export function SectionHeader({
  icon: Icon,
  title,
  meta,
  action,
}: {
  icon: LucideIcon;
  title: ReactNode;
  /** Muted inline text after the title (e.g. a timestamp). */
  meta?: ReactNode;
  /** Right-aligned slot (e.g. a "Full analysis →" link). */
  action?: ReactNode;
}) {
  return (
    <CardHeader className="-mt-4 border-b border-primary/20 bg-primary/10 pt-4">
      <CardTitle className="flex flex-wrap items-center gap-2 text-lg text-primary">
        <Icon className="size-5 shrink-0" />
        {title}
        {meta && (
          <span className="text-sm font-normal text-muted-foreground">{meta}</span>
        )}
        {action && <span className="ml-auto flex items-center">{action}</span>}
      </CardTitle>
    </CardHeader>
  );
}
