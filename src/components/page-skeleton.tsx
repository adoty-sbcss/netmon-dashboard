import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Reusable skeleton building blocks for route `loading.tsx` files. The goal is
 * a stable, layout-shaped placeholder during the (scale-to-zero) cold start and
 * on every navigation, instead of a blank screen that reads as "broken".
 */

export function HeaderSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-72 max-w-[70%]" />
    </div>
  );
}

export function StatGridSkeleton({
  count = 3,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-3", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-24 rounded-xl" />
      ))}
    </div>
  );
}

export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 md:gap-4 xl:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-32 rounded-xl" />
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <Skeleton className="h-11 w-full rounded-none" />
      <div className="divide-y">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="ml-auto hidden h-4 w-24 sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A faux secondary-tab bar — keeps the school sections feeling stable while a
 *  sub-page loads. */
export function TabsSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="flex gap-3 overflow-hidden border-b pb-2.5 sm:gap-5">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-5 w-20 shrink-0" />
      ))}
    </div>
  );
}
