/* DEV-ONLY: isolated component shots for the Help Center, with ANONYMIZED mock
 * data (generic VLAN ids + 10.0.x.x IPs — no real district topology). Each shot
 * target is wrapped in an id'd div so scripts/kb-shot.mjs can element-screenshot
 * just that component. 404s in prod (inherits the /preview dev-only guard). */
import {
  NetworksCard,
  type ReportedInterface,
} from "@/app/(dashboard)/[district]/[school]/sensor/[id]/networks-card";
import type { SensorNetwork } from "@/db/queries";

const NOW = Date.now();
const ago = (mins: number) => new Date(NOW - mins * 60_000);

// Untagged uplink + three collecting VLANs (all anonymized).
const NETWORKS: SensorNetwork[] = [
  { interface: "eth0", vlanId: null, parent: null, cidr: "10.0.0.5/24", gatewayIp: "10.0.0.1", isPrimary: true, lastScanAt: ago(58), deviceCount: 92, fresh: true },
  { interface: "eth0.10", vlanId: 10, parent: "eth0", cidr: "10.0.10.4/24", gatewayIp: "10.0.10.1", isPrimary: false, lastScanAt: ago(60), deviceCount: 64, fresh: true },
  { interface: "eth0.20", vlanId: 20, parent: "eth0", cidr: "10.0.20.7/24", gatewayIp: "10.0.20.1", isPrimary: false, lastScanAt: ago(61), deviceCount: 38, fresh: true },
  { interface: "eth0.30", vlanId: 30, parent: "eth0", cidr: "10.0.30.9/24", gatewayIp: "10.0.30.1", isPrimary: false, lastScanAt: ago(62), deviceCount: 51, fresh: true },
];
// VLAN 40 + 50 are configured but not scanned; the live interface report makes
// their state precise: 40 is up with no lease, 50 never came up.
const CONFIGURED = [10, 20, 30, 40, 50];
const REPORTED: ReportedInterface[] = [
  { name: "eth0", cidr: "10.0.0.5/24", up: true, vlan: null, primary: true },
  { name: "eth0.10", cidr: "10.0.10.4/24", up: true, vlan: 10, primary: false },
  { name: "eth0.20", cidr: "10.0.20.7/24", up: true, vlan: 20, primary: false },
  { name: "eth0.30", cidr: "10.0.30.9/24", up: true, vlan: 30, primary: false },
  { name: "eth0.40", cidr: null, up: true, vlan: 40, primary: false }, // up, no DHCP lease
  { name: "eth0.50", cidr: null, up: false, vlan: 50, primary: false }, // not up on the box
];

export default function KbShotsPage() {
  return (
    <div className="max-w-5xl">
      <div id="kb-networks-card">
        <NetworksCard
          networks={NETWORKS}
          configuredVlans={CONFIGURED}
          configApplied
          trunkParent="eth0"
          reportedInterfaces={REPORTED}
          lastHostAction={null}
        />
      </div>
    </div>
  );
}
