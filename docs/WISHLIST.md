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

## Reporting & notifications (new ideas)
- **Branded district report (PDF), tiered by depth** — generate an
  SBCSS-branded PDF summarizing the collected network data for a district, to
  hand to the district. Offer selectable report levels so a single page doesn't
  have to do every job:
    - *Summary (1 page)* — the executive one-pager: headline health, device/
      inventory counts, EOL/EOS exposure, top issues. Skimmable in a minute.
    - *Standard (few pages)* — adds topology summary, per-category breakdowns,
      trends, and the notable findings/issues list.
    - *Full (deep dive)* — the detailed technical report: per-device/per-segment
      detail, full inventory + lifecycle, all findings.
  Audience is a Director of Technology with a high-level, technically fluent
  networking background — so keep every tier dense and signal-rich, not
  dumbed-down; the tiers vary *scope/length*, not reading level. District-scoped,
  built read-time from existing data (+ optional AI summary). PDFs stored locally
  for now (filesystem/blob); email delivery comes next (see Email-out below).
- **Scheduled report runs** — let an admin configure a report to auto-generate
  on a cadence: daily / weekly / monthly, per district. Reuse the existing cron
  infrastructure (cf. the daily AI cron); persist the schedule + last-run, write
  the PDF to storage, and later hand it to the email-out delivery step.
- **Email-out (alerts, reports, other)** — outbound email from the dashboard as
  shared notification plumbing: deliver the scheduled report PDF, push alerts
  from the Actionable alerting layer / Issues tracker (Act Now / Watch tiers),
  and send other one-off notifications. Needs an SMTP / transactional-email
  config in admin (provider creds, from-address, per-district recipient lists)
  plus an opt-in / subscription model so it ties into alerting without causing
  fatigue.

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

## Device classification & fingerprinting (automatic, high-confidence)
Goal: the system auto-determines the most accurate device **type / model / OS**
per device with a **confidence score**, not one brittle guess. No single signal
is authoritative (OUI is defeated by MAC randomization, DHCP alone is coarse,
SNMP only covers managed gear), so **fuse many weak signals** and let **AI
adjudicate only the hard cases**. Runs DASHBOARD-side at ingest (internet + AI
connectors already live here); sensors stay air-gapped collect-and-bundle — they
just gather richer signals.

Pipeline:
1. **Collect signals** (sensor; most already bundled): MAC/OUI, DHCP opt 55
   + add **opt 60** (vendor class) + hostname, **mDNS/DNS-SD + SSDP/UPnP** service
   types & model strings, SNMP sysDescr/sysObjectID/Entity-MIB, open ports +
   service banners, HTTP Server header / title / **favicon hash**, TLS JA3/JARM.
2. **Deterministic match** (dashboard; offline DBs refreshed from the internet):
   - OUI: IEEE registry + merge **Wireshark `manuf`** + Nmap prefixes → vendor.
   - DHCP: own opt-55/60 fingerprint matcher (today's `classifyByDhcp` + an opt-55
     parameter-request-list matcher) seeded from OPEN data — see the Fingerbank
     decision below; Fingerbank's paid offline DB is a fallback only.
   - SNMP: **IANA PEN** + **LibreNMS/Observium sysObjectID** defs → vendor/model;
     Entity-MIB → exact model/serial.
   - mDNS/SSDP service types → role (printer / AppleTV / Chromecast / …).
   - Active: Nmap service-probes + os-db, p0f (passive) where available.
   - **CPE**: map vendor/product/version → NVD CPE (bridges to EOL + CVE later).
3. **Fuse + score**: combine candidates into one verdict with a 0–1 confidence
   (Fingerbank-style precedence/weighting + an agreement boost when independent
   signals concur — e.g. DHCP "Chromebook" + OUI "Google" + mDNS `_googlecast`
   ⇒ high-confidence ChromeOS). Keep **provenance**: which signals + which source.
4. **AI adjudication — ONLY for low-confidence / conflicting devices**: hand the
   assembled evidence (all signals + deterministic candidates) to the existing AI
   connector to pick the best label, REQUIRED to cite which signals support it and
   return its own confidence. Gate by the monthly AI spend cap. **Cache by a hash
   of the signal-set** so identical fingerprints never re-call the model (most
   devices are dupes) — this is what keeps cost sane at fleet scale.
5. **Human-in-the-loop**: operator confirms/overrides on the device page; a
   confirmation becomes a high-confidence pin that also short-circuits future
   matches (same fingerprint ⇒ same verdict, no AI call).

Persist `device_type / model / os / vendor / confidence / source(s) /
last_classified`; auto-upgrade the verdict as better signals arrive or DBs
refresh. Surface confidence + provenance in the UI, and make low-confidence a
filter / "needs review" queue.

Prioritized build order (the high-leverage 5, then AI on top):
1. **Merge Wireshark `manuf` + Nmap prefixes** into the OUI table — cheap win (DONE;
   `npm run oui:refresh` + longest-prefix lookup).
2. **DHCP opt-55 fingerprint matcher** — small hand-curated seed; AI covers the tail.
3. **mDNS/SSDP collection** — classifies the MAC-randomized mobile fleet OUI misses.
4. **sysObjectID decode** (IANA PEN + LibreNMS defs) — turns SNMP into real models.
5. **CPE/NVD mapping** — unlocks EOL + vuln correlation.
Then layer the **AI adjudicator + confirmation loop** over the scored output — it
also COMPENSATES for the staleness of the free DHCP fingerprint data (below).

Fingerbank decision (researched 2026): Fingerbank is now **Akamai-owned**; current
data lives behind a **registration-gated cloud API** (needs connectivity — out for
air-gapped) and a **paid offline SQLite DB** (contact-for-pricing). The only freely
redistributable Fingerbank data is the legacy `dhcp_fingerprints.conf` **frozen at
v6.8.2 / 2014** (ODbL 1.0 + DbCL 1.0 — usable in a gov internal tool; share-alike
only triggers if you publicly redistribute a derivative DB). DECISION: build an
**open offline stack** — our own opt-55/60 matcher (a small hand-curated seed; the
legacy ODbL file proved frozen + keyed by class-id, not worth auto-parsing), plus
the merged OUI table + mDNS — and lean on the AI adjudicator to cover the data gap. Keep Fingerbank's paid offline DB as a
documented fallback if accuracy proves insufficient. (Reimplement the approach —
don't vendor GPL-2.0 Satori code into the dashboard.)

## Bugs & fixes (reported)
- **District page → schools list + clickable school cards** — clicking the
  "Schools" stat card on the district page currently goes nowhere. It should lead
  to (or reveal) the full list of schools associated with that district, rendered
  as school cards, each clickable through to `/{district}/{school}`. (The
  per-school cards already on the district page also don't link anywhere yet —
  same fix.) Quick win.
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
