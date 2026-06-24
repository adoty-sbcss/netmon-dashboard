import { cn } from "@/lib/utils";

export type StatusTone = "ok" | "warn" | "bad";

const TONE_CLASS: Record<StatusTone, string> = {
  ok: "bg-emerald-500",
  warn: "bg-[var(--warning)]",
  bad: "bg-destructive",
};

/**
 * A small traffic-light dot for at-a-glance health. `title` doubles as the
 * accessible label and the hover tooltip explaining why the dot is that color.
 */
export function StatusDot({
  tone,
  title,
  className,
}: {
  tone: StatusTone;
  title?: string;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-block size-2 shrink-0 rounded-full", TONE_CLASS[tone], className)}
      title={title}
      aria-label={title}
      role="img"
    />
  );
}
