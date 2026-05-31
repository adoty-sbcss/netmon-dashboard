import {
  Box,
  Cctv,
  Cpu,
  HardDrive,
  HelpCircle,
  Monitor,
  Network,
  Phone,
  Printer,
  Router,
  Server,
  Shield,
  Shuffle,
  Smartphone,
  Wifi,
  type LucideIcon,
} from "lucide-react";

import type { DeviceType } from "@/lib/oui/types";
import { DEVICE_TYPE_LABELS } from "@/lib/oui/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const ICONS: Record<DeviceType, LucideIcon> = {
  switch: Network,
  router: Router,
  ap: Wifi,
  firewall: Shield,
  printer: Printer,
  phone: Phone,
  camera: Cctv,
  computer: Monitor,
  server: Server,
  mobile: Smartphone,
  storage: HardDrive,
  iot: Cpu,
  vm: Box,
  randomized: Shuffle,
  unknown: HelpCircle,
};

export function deviceTypeLabel(type: DeviceType | null | undefined): string {
  return DEVICE_TYPE_LABELS[(type ?? "unknown") as DeviceType];
}

export function DeviceTypeIcon({
  type,
  className,
}: {
  type: DeviceType | null | undefined;
  className?: string;
}) {
  const Icon = ICONS[(type ?? "unknown") as DeviceType];
  return <Icon className={className} />;
}

export function DeviceTypeBadge({
  type,
  className,
}: {
  type: DeviceType | null | undefined;
  className?: string;
}) {
  const t = (type ?? "unknown") as DeviceType;
  const Icon = ICONS[t];
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 font-normal",
        t === "unknown" && "text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-3" />
      {DEVICE_TYPE_LABELS[t]}
    </Badge>
  );
}
