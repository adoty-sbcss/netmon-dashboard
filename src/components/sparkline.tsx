import { cn } from "@/lib/utils";

export interface SparkSeries {
  /** Values in chronological order (oldest → newest). */
  points: number[];
  /** Stroke color (hex or CSS color); pass the same palette as the big chart. */
  color: string;
}

/**
 * Tiny inline trend line — pure server-rendered SVG, no recharts/client JS. Used
 * in the Speed & Bandwidth scoreboard cards so a 24h/7d trend is visible at a
 * glance without scrolling to the full chart. Multiple series share one y-scale
 * so a download line and an upload line stay visually comparable. Renders nothing
 * when there aren't at least two finite points to draw.
 */
export function Sparkline({
  series,
  width = 120,
  height = 28,
  className,
}: {
  series: SparkSeries[];
  width?: number;
  height?: number;
  className?: string;
}) {
  const all = series.flatMap((s) => s.points).filter((v) => Number.isFinite(v));
  if (all.length < 2) return null;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const range = max - min || 1;
  // 1px top/bottom padding so peaks/troughs aren't clipped at the edge.
  const y = (v: number) => height - 1 - ((v - min) / range) * (height - 2);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      className={cn("overflow-visible", className)}
      aria-hidden="true"
    >
      {series.map((s, si) => {
        const pts = s.points.filter((v) => Number.isFinite(v));
        if (pts.length < 2) return null;
        const step = width / (pts.length - 1);
        const d = pts
          .map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`)
          .join(" ");
        return (
          <polyline
            key={si}
            points={d}
            fill="none"
            stroke={s.color}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </svg>
  );
}
