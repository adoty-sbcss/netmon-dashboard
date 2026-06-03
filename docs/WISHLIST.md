# NetMon — feature wishlist / deferred work

## Integrations & platform (new ideas)
- **Uptime.com status feed** — pull the public Uptime.com status-page/API data
  into the dashboard so public-site uptime + incidents show alongside the network
  view. Dashboard-side (has internet); needs an Uptime.com API token in admin.
- **Usage analytics** — track how the dashboard is accessed/used (per-user page
  views + activity) and surface it in an admin "Usage" view. Extend the existing
  `audit_log` with page-view events via middleware; privacy-conscious (internal
  tool — keep it aggregate / county-staff-visible).
- **In-app help / chatbot** — an assistant (reusing the AI connectors) that
  answers (a) how-to questions about the app and (b) questions about the network
  data for the current scope. A chat panel given the district/school context +
  a help knowledge base (RAG over docs/DESIGN.md + this wishlist).
- **Scheduled AI across ALL scopes** — extend the daily AI cron to run every
  district + school (+ topology per school) on one schedule, auto-feeding the new
  Issues tracker. Mind token cost — gate by the monthly spend cap + cadence.
- **Azure cost in-app** — pull the dashboard resource-group cost via the Azure
  Cost Management Query API (grant the managed identity `Cost Management Reader`
  on the RG `W2-SBCSS-District-NetMon-Dashboard`), and combine with the AI token
  cost (`ai_analyses.cost_usd`) for a "total cost of the app" admin view.

## Data we currently filter out at ingest (could bring in)
The dashboard CURATES SNMP at ingest — raw is thousands of rows/scan and only a
priority subset is mirrored (the bulk `ifTable` / `ipNetToMediaTable` are capped).
The FULL raw already lives in the bundle ZIP, so most of these are ingest-only
changes (no extra collection), high value:
- **Entity-MIB serial + model** (`entPhysicalSerialNum` / `entPhysicalModelName`)
  — already collected; surfacing it gives real serial numbers + clean model
  strings → much better inventory + EOL matching. Best effort/value ratio.
- **Per-interface status / speed / errors / utilization** (`ifXTable` HC counters,
  `ifOperStatus`, `ifSpeed`, `ifAlias`) — link health, edge thickness/labels on
  the map, "what's saturated," an Interfaces panel.
- **PoE per-port** (`POWER-ETHERNET-MIB`) — power draw; auto-spot APs/cameras +
  power budget. (Needs a small collector add.)
- **STP port roles** (`dot1dStpPortTable`) — show active vs blocked redundant links.
- **sysObjectID → vendor/model decode** (static table) — cleaner identity + icons.

## Bugs & fixes (reported)
- **District page school links** — the "Schools" stat card and the per-school
  cards on the district page don't link anywhere; they should go to
  `/{district}/{school}`. (Quick fix.)
- **Map lost drag-to-move + Save layout** — the old SVG map persisted manual node
  positions (topology_positions + saveMapPositions). The new Cytoscape map
  doesn't load/save positions, so dagre re-lays-out every visit. Re-wire: load
  saved positions, allow node drag, add a Save button; saved positions override
  the auto-layout.
- **Sensor data reset / purge** — need a one-click "wipe all collected data for
  this sensor, keep it enrolled" for the office-test → field-deploy workflow.
  Partially exists already: Settings → Data management has a date-range scan
  purge (`purgeScansAction`) and a delete-sensor (cascades all scans). To add: an
  "all data" purge that keeps the sensor + its config/enrollment, surfaced on the
  sensor detail page (not just buried in settings).

## Findings section — decision needed
Today `findings` is a flat, per-scan list (mostly AI-generated). Two paths:
- **(Recommended) Turn it into a persistent "Issues" tracker** — one row per
  distinct issue (keyed by rule + device/scope), not one-per-scan; state
  open/acknowledged/resolved; auto-resolve when it stops recurring across N
  scans; track first-seen / last-seen / recurrence / resolved-at for history.
  This IS the "actionable alerting layer" keystone — the anti-fatigue, checked-
  off-when-gone list the owner described.
- **(Short-term) Consolidate findings into the AI-analysis tab** and drop the
  standalone findings surfaces, then build the Issues tracker later.



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
