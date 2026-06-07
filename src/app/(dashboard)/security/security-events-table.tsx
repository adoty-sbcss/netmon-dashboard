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

export function SecurityEventsTable({ events }: { events: SecurityEventItem[] }) {
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
                  <TableHead>When</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead className="hidden sm:table-cell">Category</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="hidden md:table-cell">Actor</TableHead>
                  <TableHead className="hidden lg:table-cell">Source IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((e) => (
                  <TableRow key={e.id}>
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
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
