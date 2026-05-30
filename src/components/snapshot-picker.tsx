"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { History } from "lucide-react";

import type { ScanSnapshot } from "@/db/queries";
import { dateTime } from "@/lib/format";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const LATEST = "latest";

/**
 * Snapshot picker: writes the chosen scan id into the `?scan=` URL param so the
 * server re-renders the page for that point in time. "Latest" drops the param
 * (canonical, deduped current view).
 */
export function SnapshotPicker({
  snapshots,
  value,
}: {
  snapshots: ScanSnapshot[];
  /** Currently-selected scan id, or null for the latest/canonical view. */
  value: number | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function onChange(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === LATEST) {
      params.delete("scan");
    } else {
      params.set("scan", next);
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="flex items-center gap-2">
      <History className="size-4 text-muted-foreground" />
      <Select value={value == null ? LATEST : String(value)} onValueChange={onChange}>
        <SelectTrigger className="w-[260px]" size="sm">
          <SelectValue placeholder="Latest" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={LATEST}>Latest (current view)</SelectItem>
          {snapshots.map((s) => (
            <SelectItem key={s.scanId} value={String(s.scanId)}>
              {dateTime(s.startedAt)} · {s.sensorSlug}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
