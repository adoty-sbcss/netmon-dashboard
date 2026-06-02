# NetMon — feature wishlist / deferred work

Running list so nothing gets lost while we focus on network mapping. Ordered
roughly by value. Not committed scope — a parking lot to pull from.

## Deferred from Phase 1 (registry quick-wins)
- **EOL/EOS + firmware lookup** (task #68): admin page for per-vendor API keys
  (Cisco/Meraki) + operator CSV/Excel upload of EOL data; dashboard-side lookup
  (endoflife.date → vendor API → uploaded), firmware parsed from SNMP sysDescr;
  surface near/past end-of-support on registry + map. Highest-ROI quick win.
  Schema already exists (`lifecycle_models`, `lifecycle_sources`).
- **"Newly discovered" feed + "Attention" rollup** (task #70): low-overhead feed
  of auto-discovered devices not in the registry (sticky acknowledge/mute,
  `device_acks` table already exists); plus a read-time rollup of past/near-EOS,
  new-this-week, and gone-silent devices. No alert engine, no notifications.

## Bigger features (own phases)
- **Actionable alerting layer**: persist a condition across N scans before
  surfacing, group related symptoms per device/switch into one incident,
  severity tiers (Act Now / Watch / Info), maintenance windows, per-device-type
  expected behavior (camera always pings, printer may sleep). The anti-fatigue
  keystone — likely realized partly via the AI analysis.
- **Secure switch config backup (Phase 3, needs credentials)**: store device SSH
  creds encrypted in the dashboard, hand to the sensor over the existing
  command-queue control plane, sensor pulls `show running-config` on its segment
  (read-only user), versioned storage on diff, side-by-side diff view, built-in
  best-practice checks (telnet on, default community, no BPDU guard, NTP unset,
  …) + AI topology/perf analysis.
- **Active DHCP scope health**: true utilization % / used / free per scope —
  needs to query the DHCP server (Windows PowerShell or Cisco DHCP-MIB). Pair
  with the credentialed phase above.
- **Building / Room-IDF hierarchy level**: a location tier below School (registry
  already has free-text building/room fields as a stop-gap).
- **RBAC server-side scope filtering + per-school edit**: today `queries.ts`
  returns all districts to any logged-in user (client-side filtering only);
  grants schema supports school/sensor scopes but they aren't enforced.
- **WMI monitoring (Windows)**: device monitor-type is selectable in the registry
  but inert until we accept Windows credentials.
- **AP metrics**: per-AP client count + channel utilization + PoE (vendor SNMP).

## Network map — shipped + next steps
Shipped: read-time deterministic graph, FDB device-to-access-port attachment
(uplink-disambiguated), Cytoscape hierarchical renderer (icons/shapes, hover,
click-through, infra-only toggle, fit, PNG + CSV export), and an AI topology
review (kind='topology' analyses) on the map tab.

Next steps (come back to these):
- **Collapsible "N devices" leaf groups** (the green-chevron folders) for sites
  with large leaf counts — expand/collapse per switch.
- **Status coloring on map nodes** (online / offline / SNMP-gap) from the
  inventory overlay; border or badge per node.
- **Wireless (dotted) edges** — needs AP client-association collection
  (vendor-specific: Meraki API, Cisco WLC, Aruba, UniFi).
- **Re-add the logical (subnet/VLAN) map view** + a physical/logical toggle
  (the old SVG NetworkMap was set aside when physical went to Cytoscape).
- **Edge/port labels** — show the switch port (ifName) on hover/click of an edge.
- **Floating/known-but-unplaced switches** — add discovered switches that aren't
  yet on the LLDP backbone so their FDB devices still show (currently skipped).
- **Per-interface detail + link utilization** — collect ifXTable HC counter
  deltas (+ ifOperStatus/ifSpeed/ifAlias) → link up/down, speed, % util, edge
  thickness, an "Interfaces" panel.
- **PoE per-port** (POWER-ETHERNET-MIB) and **WAN throughput** (router WAN HC
  octet deltas) for the "Down/Up Mb/s" uplink label.
- **SVG / Visio export** (currently PNG + CSV) via cytoscape-svg + a VDX/CSV.
- **STP port roles** (dot1dStpPortTable) → show active vs blocked redundant links.

## In focus now
- **Consolidate device views** — fold Inventory + Switches + Hosts + Neighbors +
  Registry into one "Devices" hub.
