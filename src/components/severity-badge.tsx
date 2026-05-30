import { cn } from "@/lib/utils";

const STYLES: Record<string, string> = {
  critical:
    "border-transparent bg-destructive text-white",
  high: "border-transparent bg-destructive/15 text-destructive dark:text-red-300",
  medium:
    "border-transparent bg-[var(--warning)]/15 text-[var(--warning)] dark:brightness-125",
  low: "border-transparent bg-[var(--info)]/15 text-[var(--info)] dark:brightness-125",
  info: "border-transparent bg-muted text-muted-foreground",
};

export function SeverityBadge({ severity }: { severity: string }) {
  const key = severity?.toLowerCase() ?? "info";
  const style = STYLES[key] ?? STYLES.info;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium capitalize",
        style,
      )}
    >
      {severity || "info"}
    </span>
  );
}
