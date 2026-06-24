import { Globe, Gauge } from "lucide-react";

import { SpeedtestLatest } from "./speedtest-latest";
import { IperfLatest } from "./iperf-latest";
import { UplinkGlance, type UplinkGlanceProps } from "./uplink-glance";
import type { SpeedCardVM, IperfCardVM } from "./summary";

function ColumnHeader({
  Icon,
  title,
  subtitle,
}: {
  Icon: typeof Globe;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold">
      <Icon className="size-4 text-primary" /> {title}
      <span className="font-normal text-muted-foreground">· {subtitle}</span>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/**
 * The at-a-glance header for the Speed & Bandwidth page: internet (public speed
 * test) and internal (iperf) latest results as a matched side-by-side pair, with
 * a compact WAN-utilization strip beneath. Renders nothing when the school has no
 * speed/iperf/uplink data at all — the detail sections below carry their own
 * "how to enable" empty states in that case.
 */
export function SpeedScoreboard({
  internet,
  iperf,
  uplink,
}: {
  internet: SpeedCardVM[];
  iperf: IperfCardVM[];
  uplink: UplinkGlanceProps | null;
}) {
  if (internet.length === 0 && iperf.length === 0 && uplink == null) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <ColumnHeader Icon={Globe} title="Internet" subtitle="public speed test" />
          {internet.length > 0 ? (
            <SpeedtestLatest items={internet} />
          ) : (
            <EmptyHint>No public speed tests yet for this site.</EmptyHint>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <ColumnHeader Icon={Gauge} title="Internal" subtitle="iperf throughput" />
          {iperf.length > 0 ? (
            <IperfLatest items={iperf} />
          ) : (
            <EmptyHint>No internal iperf runs yet for this site.</EmptyHint>
          )}
        </div>
      </div>
      {uplink && <UplinkGlance {...uplink} />}
    </div>
  );
}
