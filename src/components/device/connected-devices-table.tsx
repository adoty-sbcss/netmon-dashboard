import Link from "next/link";
import { Cable } from "lucide-react";

import type { ConnectedDevice } from "@/db/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeviceTypeBadge } from "@/components/device-type-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * Devices the bridge forwarding table shows directly attached to this switch/
 * router, by port. Clickable through to each host's page. Renders nothing when
 * the FDB resolved no access-attached devices. Shared by the switch + host pages.
 */
export function ConnectedDevicesTable({
  devices,
  basePath,
}: {
  devices: ConnectedDevice[];
  basePath: string;
}) {
  if (devices.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Cable className="size-4 text-primary" />
          Connected devices
          <span className="ml-1 text-sm font-normal text-muted-foreground">
            {devices.length} attached
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 sm:px-6">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Port</TableHead>
                <TableHead>Device</TableHead>
                <TableHead className="hidden sm:table-cell">IP</TableHead>
                <TableHead className="hidden md:table-cell">MAC</TableHead>
                <TableHead className="hidden md:table-cell">Type</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.map((d) => (
                <TableRow key={`${d.ifName ?? ""}-${d.mac}`}>
                  <TableCell className="font-mono text-xs">{d.ifName ?? "—"}</TableCell>
                  <TableCell className="max-w-[16rem] truncate">
                    {d.hostEntityId ? (
                      <Link
                        href={`${basePath}/host/${d.hostEntityId}`}
                        className="text-primary hover:underline"
                      >
                        {d.hostname || d.ip || d.mac}
                      </Link>
                    ) : (
                      d.hostname || d.ip || d.mac
                    )}
                  </TableCell>
                  <TableCell className="hidden font-mono tabular-nums sm:table-cell">
                    {d.ip ?? "—"}
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs md:table-cell">
                    {d.mac}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <DeviceTypeBadge type={d.deviceType} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="px-6 pt-3 text-xs text-muted-foreground sm:px-0">
          From the switch&apos;s bridge forwarding table (each device shown on its
          access port — the one learning the fewest MACs).
        </p>
      </CardContent>
    </Card>
  );
}
