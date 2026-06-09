"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";

import { SeverityBadge } from "@/components/severity-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { dateTime, relativeTime } from "@/lib/format";
import type { SecurityEventItem } from "@/lib/ai/security-queries";

const COLSPAN = 7;

function detailString(detail: unknown): string | null {
  if (!detail || typeof detail !== "object") return null;
  if (Object.keys(detail as Record<string, unknown>).length === 0) return null;
  try {
    return JSON.stringify(detail, null, 2);
  } catch {
    return null;
  }
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={mono ? "break-all font-mono text-xs" : "text-sm"}>{value}</dd>
    </div>
  );
}

export function SecurityEventsTable({ events }: { events: SecurityEventItem[] }) {
  const [openId, setOpenId] = React.useState<number | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent security events</CardTitle>
      </CardHeader>
      <CardContent className="px-0 sm:px-6">
        {events.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            No security events recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>When</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead className="hidden sm:table-cell">Category</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="hidden md:table-cell">Actor</TableHead>
                  <TableHead className="hidden lg:table-cell">Source IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((e) => {
                  const open = openId === e.id;
                  const detail = detailString(e.detail);
                  return (
                    <React.Fragment key={e.id}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => setOpenId(open ? null : e.id)}
                      >
                        <TableCell className="text-muted-foreground">
                          <ChevronRight
                            className={`size-4 transition-transform ${open ? "rotate-90" : ""}`}
                          />
                        </TableCell>
                        <TableCell
                          className="whitespace-nowrap text-muted-foreground"
                          title={dateTime(e.at)}
                        >
                          {relativeTime(e.at)}
                        </TableCell>
                        <TableCell>
                          <SeverityBadge severity={e.severity} />
                        </TableCell>
                        <TableCell className="hidden capitalize text-muted-foreground sm:table-cell">
                          {e.category}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{e.action}</TableCell>
                        <TableCell className="hidden max-w-[16rem] truncate md:table-cell">
                          {e.actor ?? <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="hidden font-mono text-xs lg:table-cell">
                          {e.sourceIp ?? <span className="text-muted-foreground">—</span>}
                        </TableCell>
                      </TableRow>
                      {open && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={COLSPAN} className="py-3">
                            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
                              <Field label="Time" value={dateTime(e.at)} />
                              <Field label="Category" value={e.category} />
                              <Field label="Action" value={e.action} mono />
                              <Field
                                label="Actor"
                                value={`${e.actor ?? "—"}${e.actorType ? ` (${e.actorType})` : ""}`}
                              />
                              <Field label="Source IP" value={e.sourceIp ?? "—"} mono />
                              <Field label="Target" value={e.target ?? "—"} mono />
                              <div className="col-span-2 sm:col-span-3 lg:col-span-4">
                                <Field label="User agent" value={e.userAgent ?? "—"} mono />
                              </div>
                            </dl>
                            {detail && (
                              <div className="mt-3">
                                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                  Detail
                                </p>
                                <pre className="mt-1 max-h-60 overflow-auto rounded bg-background p-2 text-[11px] leading-relaxed">
                                  {detail}
                                </pre>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
