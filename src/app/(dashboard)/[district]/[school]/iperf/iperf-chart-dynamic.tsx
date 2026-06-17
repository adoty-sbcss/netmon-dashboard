"use client";

import dynamic from "next/dynamic";

/**
 * Lazy-loaded wrapper around {@link IperfChart}. recharts (+ its d3 deps) is the
 * only consumer of recharts in the app and is ~100KB+ gzipped; statically
 * importing it pulled the whole library into the Speed & Bandwidth route's
 * initial bundle. The charts sit below the stat cards and render on data, so
 * loading recharts on demand (client-side, no SSR) is imperceptible and keeps it
 * out of first-load JS. Same props/usage as the underlying component.
 */
export const IperfChart = dynamic(
  () => import("./iperf-chart").then((m) => m.IperfChart),
  {
    ssr: false,
    loading: () => (
      <div className="h-72 w-full animate-pulse rounded-md bg-muted/30" />
    ),
  },
);
