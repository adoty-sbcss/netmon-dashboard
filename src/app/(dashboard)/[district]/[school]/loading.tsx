import {
  HeaderSkeleton,
  StatGridSkeleton,
  TableSkeleton,
  TabsSkeleton,
} from "@/components/page-skeleton";

// Covers the school overview and all of its sub-tabs (map, devices, DHCP, …).
// The faux tab bar keeps the section feeling stable as you switch tabs.
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <TabsSkeleton />
      <HeaderSkeleton />
      <StatGridSkeleton count={3} />
      <StatGridSkeleton count={3} />
      <TableSkeleton />
    </div>
  );
}
