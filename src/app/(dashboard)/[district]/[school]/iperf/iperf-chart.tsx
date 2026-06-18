"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// Distinct, color-blind-friendlyish line colors, reused round-robin per series.
const COLORS = [
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#9333ea",
  "#dc2626",
  "#0891b2",
  "#ca8a04",
  "#db2777",
];

/**
 * Throughput-over-time line chart. `series` is a pivoted array of points
 * { ts, "<series key>": mbps, ... }; `keys` lists the series (one per
 * sensor+direction). Built on the server so no Date objects cross the boundary.
 */
export function IperfChart({
  series,
  keys,
  referenceY,
  referenceLabel,
}: {
  series: Array<Record<string, number>>;
  keys: string[];
  /** Optional horizontal reference line (e.g. the contracted WAN rate). */
  referenceY?: number | null;
  referenceLabel?: string;
}) {
  if (series.length === 0 || keys.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        No successful runs to chart yet.
      </p>
    );
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tick={{ fontSize: 11 }}
            tickFormatter={(t) =>
              new Date(Number(t)).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })
            }
          />
          <YAxis
            tick={{ fontSize: 11 }}
            width={48}
            label={{ value: "Mbps", angle: -90, position: "insideLeft", fontSize: 11 }}
          />
          <Tooltip
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(t) => new Date(Number(t)).toLocaleString()}
            formatter={(v) => [`${Number(v).toFixed(1)} Mbps`]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {referenceY != null && referenceY > 0 && (
            <ReferenceLine
              y={referenceY}
              stroke="var(--destructive)"
              strokeDasharray="6 4"
              strokeWidth={1.5}
              ifOverflow="extendDomain"
              label={{
                value: referenceLabel ?? `${referenceY} Mbps`,
                position: "insideTopRight",
                fontSize: 11,
                fill: "var(--destructive)",
              }}
            />
          )}
          {keys.map((k, i) => (
            <Line
              key={k}
              type="monotone"
              dataKey={k}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
