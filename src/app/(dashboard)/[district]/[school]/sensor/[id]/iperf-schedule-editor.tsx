"use client";

import { useState } from "react";
import { Plus, X, Trash2, CalendarClock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { IperfScheduleEntry } from "@/lib/iperf-actions";

type Draft = IperfScheduleEntry;

/** Day indices are Mon=0 … Sun=6 to match the collector's `weekday()`. */
const DAYS = [
  { i: 0, label: "Mo" },
  { i: 1, label: "Tu" },
  { i: 2, label: "We" },
  { i: 3, label: "Th" },
  { i: 4, label: "Fr" },
  { i: 5, label: "Sa" },
  { i: 6, label: "Su" },
];
const WEEKDAYS = [0, 1, 2, 3, 4];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const selectCls =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

function newRow(): Draft {
  return { protocol: "tcp", direction: "down", duration: 10, times: [], days: [0, 1, 2, 3, 4, 5, 6] };
}

function daySummary(days: number[]): string {
  if (days.length === 0) return "no days — won't run";
  const s = [...days].sort((a, b) => a - b);
  if (s.length === 7) return "every day";
  if (s.length === 5 && WEEKDAYS.every((d) => s.includes(d))) return "weekdays";
  return s.map((d) => DAYS[d].label).join(" · ");
}

function RowEditor({
  row,
  onChange,
  onRemove,
}: {
  row: Draft;
  onChange: (r: Draft) => void;
  onRemove: () => void;
}) {
  const [pending, setPending] = useState("");
  const incomplete = row.times.length === 0 || row.days.length === 0;

  const addTime = () => {
    if (!TIME_RE.test(pending) || row.times.includes(pending)) return;
    onChange({ ...row, times: [...row.times, pending].sort() });
    setPending("");
  };
  const toggleDay = (d: number) =>
    onChange({
      ...row,
      days: row.days.includes(d) ? row.days.filter((x) => x !== d) : [...row.days, d].sort((a, b) => a - b),
    });

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={row.protocol}
          onChange={(e) => onChange({ ...row, protocol: e.target.value as Draft["protocol"] })}
          className={selectCls}
          aria-label="Protocol"
        >
          <option value="tcp">TCP</option>
          <option value="udp">UDP</option>
        </select>
        <select
          value={row.direction}
          onChange={(e) => onChange({ ...row, direction: e.target.value as Draft["direction"] })}
          className={selectCls}
          aria-label="Direction"
        >
          <option value="down">Download ↓</option>
          <option value="up">Upload ↑</option>
          <option value="both">Both ↕</option>
        </select>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Input
            type="number"
            min={1}
            max={60}
            value={row.duration}
            onChange={(e) =>
              onChange({ ...row, duration: Math.max(1, Math.min(60, Number(e.target.value) || 10)) })
            }
            className="h-8 w-16"
            aria-label="Seconds per test"
          />
          s
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="ml-auto text-destructive hover:text-destructive"
          onClick={onRemove}
          aria-label="Remove schedule"
        >
          <Trash2 />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">at</span>
        {row.times.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
          >
            {t}
            <button type="button" onClick={() => onChange({ ...row, times: row.times.filter((x) => x !== t) })} aria-label={`Remove ${t}`}>
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          type="time"
          value={pending}
          onChange={(e) => setPending(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTime();
            }
          }}
          className={`${selectCls} w-32`}
          aria-label="Add a time"
        />
        <Button type="button" variant="outline" size="sm" onClick={addTime} disabled={!TIME_RE.test(pending)}>
          <Plus /> time
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-muted-foreground">on</span>
        {DAYS.map((d) => {
          const active = row.days.includes(d.i);
          return (
            <button
              key={d.i}
              type="button"
              onClick={() => toggleDay(d.i)}
              aria-pressed={active}
              className={`h-7 min-w-9 rounded-md border px-1.5 text-xs transition-colors ${
                active
                  ? "border-primary bg-primary/10 font-medium text-primary"
                  : "border-input text-muted-foreground hover:bg-muted"
              }`}
            >
              {d.label}
            </button>
          );
        })}
        <span className="ml-1 text-xs text-muted-foreground">{daySummary(row.days)}</span>
      </div>

      {incomplete && (
        <p className="text-xs text-[var(--warning)]">
          Add at least one time and one day, or remove this row — it won&apos;t run as-is.
        </p>
      )}
    </div>
  );
}

/**
 * Editor for a sensor's iperf cron schedules. Holds the list in state and mirrors
 * it into a hidden `schedules` field (JSON) the form action parses + validates.
 * Each row = protocol · direction (download/upload/both) · per-test seconds ·
 * one or more times · days of week. Times are evaluated in Pacific on the box.
 */
export function IperfScheduleEditor({ initial }: { initial: IperfScheduleEntry[] }) {
  const [rows, setRows] = useState<Draft[]>(() =>
    initial.map((r) => ({ ...r, times: [...r.times], days: [...r.days] })),
  );

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="schedules" value={JSON.stringify(rows)} />
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
          No schedules yet. Add one to run iperf at set times — e.g. TCP upload at 05:00 and 17:00
          every day, or UDP both directions at 01:00 on Mon/Wed/Fri.
        </p>
      ) : (
        rows.map((r, i) => (
          <RowEditor
            key={i}
            row={r}
            onChange={(updated) => setRows((rs) => rs.map((x, idx) => (idx === i ? updated : x)))}
            onRemove={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
          />
        ))
      )}
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setRows((rs) => [...rs, newRow()])}
        >
          <Plus /> Add schedule
        </Button>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarClock className="size-3.5" /> times are Pacific · &quot;both&quot; = download then upload
        </span>
      </div>
    </div>
  );
}
