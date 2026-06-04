# Device classification — data model + scoring (design sketch)

Status: **partially implemented** (engine + persistence done). Companion to the
wishlist item "Device classification & fingerprinting (automatic, high-confidence)".

## Implemented (v1)
- **Fusion engine** — `src/lib/classify` (`classify` / `gatherCandidates` / `fuse`
  / `signalHashFor` / `classifyHost`). Scores each signal, fuses with an agreement
  bonus, flags `needsAi` on weak/conflicting results, emits a `signalHash`.
- **Persistence on `entities_host`** (NOT a separate table — see §2): columns
  `class_confidence`, `class_method`, `class_sources`, `class_signal_hash`
  (migration `drizzle/0025_greedy_harpoon.sql`). Reuses the existing canonical
  host + its `device_type_override` as the human-"confirmed" path, so no separate
  pins table or duplicate human-loop for v1.
- **Wiring** — written by the inline ingest upsert (`src/ingest/ingest.ts`, scored
  fields kept in lockstep with the winning `device_type`) and backfilled by
  `src/ingest/enrich.ts` (`npm run enrich`, which also fills rows predating the columns).
- **UI surface** — the Devices hub (`devices-hub.tsx`) shows a confidence % next to
  auto types and a "Needs review (N)" filter; `getInventoryForSchool` exposes
  `confidence` / `confirmed` / `needsReview` (registry match or `deviceTypeOverride`
  ⇒ confirmed, score hidden).
- **DHCP opt-55 matcher** — `classifyByDhcpFingerprint` + `dhcp-fingerprints.json`
  seed + `npm run dhcp:refresh` (regenerates from the open ODbL legacy file); wired
  as a distinct `dhcp.opt55` candidate. This is the OUI-blind mobile-fleet win.
- **AI adjudicator (core)** — `src/lib/classify/adjudicate.ts`: evidence builder,
  strict prompt + JSON verdict parser, signalHash cache (reuses prior AI verdicts),
  budget gate, and DB writeback (`class_method='ai'`). The model call + budget check
  are INJECTED.

Still TODO: wire the adjudicator's `CallModel` to the AI provider seam (src/lib/ai)
+ a `WithinBudget` to the monthly spend cap, add a Container Apps Job/CLI entry to
run it, and surface the AI rationale (stored on `attributes.classification`) in the
device detail. Then: mDNS/SSDP + sysObjectID + CPE signals (wishlist priorities 3–5).

> Why `entities_host` instead of the separate `device_classifications` table the
> rest of this doc sketches: that table assumed nothing already persisted a per-MAC
> verdict, but `entities_host` is exactly that (deduped on district+mac, survives the
> 30-day purge) and already carries `device_type` + `device_type_override`. Storing
> the scores there avoids a parallel table + join and reuses the existing override
> as the confirmed path. The separate-table design below is kept for reference / if
> classification history is ever needed.

Goal: for every distinct device (keyed by MAC, per school/sensor scope) produce
the **most accurate `device_type` / `model` / `os` with a 0–1 confidence and full
provenance**, by fusing many weak signals deterministically and escalating only
the hard cases to AI. Runs **dashboard-side at ingest** (internet + AI live here);
sensors keep collecting + bundling, nothing new runs air-gapped.

---

## 1. Where it fits

Today `devices` rows are **per-scan** (one row per scan_run × host). Classification
needs to **persist and improve across scans**, so add a MAC-keyed table that the
ingest step upserts into after each bundle is parsed:

```
bundle → parse (existing) → assemble per-MAC signal set → classify() → upsert
         device_classifications  → (low confidence?) → queue for AI adjudication
```

The signal set is read from existing tables, no new collection required for the
first cut:
- **OUI / vendor** — `devices.mac` → `lib/oui` (now MA-L/M/S + Wireshark/Nmap).
- **DHCP** — `dhcp_observations.vendorClassId` (opt 60), `paramReqList` (opt 55),
  `clientHostname` (opt 12).
- **SNMP** — `snmp_polls` (sysDescr, sysObjectID, Entity-MIB), `entities_switch.attributes`.
- **LLDP/CDP** — `neighbors.systemDescription` / `capabilities`.
- **Hostname** — `devices.hostname`.
- (later) mDNS/SSDP service types, HTTP/TLS banners — new collection, slot in as
  more signal sources.

---

## 2. Data model

```ts
// src/db/schema/netmon.ts (or a new classification.ts)
export const deviceClassifications = pgTable(
  "device_classifications",
  {
    id: serial("id").primaryKey(),
    // Scope: classification is per device per school (sensor). MAC is the key.
    schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
    mac: text("mac").notNull(),

    // The fused verdict.
    deviceType: text("device_type").notNull(),         // DeviceType vocab (lib/oui/types)
    model: text("model"),
    os: text("os"),
    vendor: text("vendor"),
    confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(), // 0.000–1.000

    // How we got here.
    method: text("method").notNull(),                  // 'deterministic' | 'ai' | 'confirmed'
    // Provenance: every signal that contributed + its source + the type it argued
    // for + its score. Drives the "why" tooltip and the needs-review queue.
    sources: jsonb("sources").notNull().default([]),   // Array<{signal, source, type, score}>

    // Hash of the normalized signal set. Two purposes:
    //   1. AI cache key — identical fingerprints never re-call the model.
    //   2. Change detection — only re-classify when the signals actually changed.
    signalHash: text("signal_hash").notNull(),
    aiVerdict: jsonb("ai_verdict"),                    // cached raw AI output (nullable)

    // Human-in-the-loop override (becomes ground truth + pins future matches).
    confirmedBy: integer("confirmed_by").references(() => users.id),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),

    firstClassifiedAt: timestamp("first_classified_at", { withTimezone: true }).notNull().defaultNow(),
    lastClassifiedAt: timestamp("last_classified_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_devclass_school_mac").on(t.schoolId, t.mac),
    index("idx_devclass_signalhash").on(t.signalHash),     // AI cache lookups
    index("idx_devclass_lowconf").on(t.confidence),        // needs-review queue
  ],
);
```

Optional second table `classification_pins` (signalHash → confirmed verdict) so a
human confirmation generalizes to *every* device with the same fingerprint, even
across schools. Cheaper than re-confirming identical devices.

---

## 3. Signal weights (base confidence)

No signal is authoritative alone; each contributes a candidate `{type, score}`.
Starting weights (tune empirically):

| Signal                                   | Base score | Notes |
|------------------------------------------|-----------:|-------|
| SNMP sysObjectID / Entity-MIB model      | 0.95 | exact model when present |
| SNMP sysDescr keyword                    | 0.85 | managed gear only |
| DHCP opt55/60 fingerprint match          | 0.90 | best for endpoints; open seed data (see §7) |
| mDNS/SSDP service type (later)           | 0.85 | `_ipp`=printer, `_googlecast`=Chromecast … |
| LLDP/CDP sysDescr / capabilities         | 0.80 | infra-to-infra |
| DHCP opt-60 vendor-class keyword rule    | 0.70 | the current `classifyByDhcp` |
| Hostname keyword                         | 0.50 | naming conventions vary |
| OUI vendor-name keyword                  | 0.40 | vendor ≠ role |
| Randomized/locally-administered MAC      |  —   | label "randomized", don't guess |

---

## 4. Scoring / fusion function

Extend the existing `lib/oui` classifier to emit **scored candidates with
provenance** instead of a single label, then fuse:

```ts
interface Candidate { type: DeviceType; score: number; signal: string; source: string; }

interface Verdict {
  type: DeviceType; confidence: number; method: "deterministic" | "ai" | "confirmed";
  sources: Candidate[]; needsAi: boolean;
}

const AGREE_BONUS = 0.06;   // per extra independent signal that agrees
const AI_THRESHOLD = 0.75;  // below this → escalate
const CONFLICT_MARGIN = 0.1;// top-2 this close & different type → escalate

function fuse(cands: Candidate[]): Verdict {
  if (cands.length === 0) return { type: "unknown", confidence: 0, method: "deterministic", sources: [], needsAi: true };

  // Group by candidate type, take the strongest signal per type, then add a
  // small bonus for each *additional independent* signal that agrees.
  const byType = new Map<DeviceType, Candidate[]>();
  for (const c of cands) (byType.get(c.type) ?? byType.set(c.type, []).get(c.type)!).push(c);

  const scored = [...byType.entries()].map(([type, cs]) => {
    const best = Math.max(...cs.map((c) => c.score));
    const agree = Math.min(cs.length - 1, 3) * AGREE_BONUS;   // cap the bonus
    return { type, confidence: Math.min(0.99, best + agree), supporting: cs };
  }).sort((a, b) => b.confidence - a.confidence);

  const top = scored[0];
  const runnerUp = scored[1];
  const conflict = runnerUp && top.confidence - runnerUp.confidence < CONFLICT_MARGIN;
  const needsAi = top.confidence < AI_THRESHOLD || !!conflict;

  return {
    type: top.type,
    confidence: top.confidence,
    method: "deterministic",
    sources: top.supporting,
    needsAi,
  };
}
```

`classify(signals)` collects candidates from every available signal (SNMP, DHCP,
mDNS, LLDP, hostname, OUI — reusing the existing rule tables), calls `fuse()`, and
returns the verdict + `signalHash = sha256(canonical(signals))`.

---

## 5. AI adjudication (only the hard cases)

When `verdict.needsAi`:
1. **Cache check** — if a row (or `classification_pins`) with the same `signalHash`
   already has an AI/confirmed verdict, reuse it. (Most devices are duplicates →
   most "needs AI" devices never actually call the model.)
2. **Spend gate** — skip if the monthly AI cap is hit; keep the deterministic
   verdict and mark `needsAi` for later.
3. **Call** — hand the existing AI connector the full evidence (all raw signals +
   the deterministic candidates) with a strict contract:

```jsonc
// AI must return ONLY this, and cite which signals support it:
{ "device_type": "...", "model": "...|null", "os": "...|null",
  "confidence": 0.0, "cited_signals": ["dhcp.opt55", "oui.vendor"], "rationale": "..." }
```

Store `aiVerdict`, set `method:"ai"`, `confidence` from the model (capped, e.g.
≤0.9 unless a human confirms), and persist provenance. Cache by `signalHash`.

---

## 6. Human-in-the-loop

On the device page, an operator can confirm or override. A confirmation:
- sets `method:"confirmed"`, `confidence:1.0`, records `confirmedBy/At`;
- writes a `classification_pins` row for that `signalHash` so **every** matching
  device (now and future) short-circuits straight to the confirmed verdict — no
  deterministic scoring, no AI call.

Surface `confidence` + `sources` in the UI, and make **low-confidence a filter**
("needs review" queue) so humans spend effort where it moves the needle.

---

## 7. Rollout (maps to the 5 priorities + AI)

1. Ship the table + `fuse()` over **today's** signals (OUI, DHCP rules, SNMP,
   hostname). Pure deterministic, no AI yet — immediate confidence scores.
2. Merge Wireshark/Nmap into OUI (**done** — `npm run oui:refresh`).
3. Add a **DHCP opt-55 fingerprint matcher** seeded from open data (legacy ODbL
   Fingerbank `dhcp_fingerprints.conf` + community signature lists). Current
   Fingerbank is Akamai-owned (cloud API = online-only; offline SQLite DB = paid),
   so treat it as a documented paid fallback, not the primary source. The AI
   adjudicator covers the staleness of the free 2014 data. Reimplement the matcher —
   don't vendor GPL-2.0 Satori code into the dashboard.
4. Add **sysObjectID decode** (IANA PEN + LibreNMS defs) for real models.
5. Add **mDNS/SSDP** signal (needs sensor collection) — kills the OUI-blind mobile gap.
6. Layer **AI adjudication + confirmation loop** over the scored output.
7. Add **CPE/NVD** mapping off `model`/`os` → unlocks EOL + CVE correlation.
```
