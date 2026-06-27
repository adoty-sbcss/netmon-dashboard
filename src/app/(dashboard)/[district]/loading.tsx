import {
  CardGridSkeleton,
  HeaderSkeleton,
  StatGridSkeleton,
} from "@/components/page-skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <HeaderSkeleton />
      <StatGridSkeleton count={3} />
      <CardGridSkeleton count={6} />
    </div>
  );
}
