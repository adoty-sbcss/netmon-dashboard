import {
  CardGridSkeleton,
  HeaderSkeleton,
  StatGridSkeleton,
} from "@/components/page-skeleton";

// Shown inside the dashboard shell (sidebar/header stay put) while a top-level
// page loads — notably the ~cold-start first hit after scale-to-zero.
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <HeaderSkeleton />
      <StatGridSkeleton count={4} className="lg:grid-cols-4" />
      <CardGridSkeleton count={6} />
    </div>
  );
}
