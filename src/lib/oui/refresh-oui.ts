/**
 * refresh-oui.ts — regenerate the MAC-vendor registries from public sources.
 *
 * Merges, in precedence order (first writer wins per prefix):
 *   1. IEEE MA-L / MA-M / MA-S  — authoritative org names   (standards-oui.ieee.org)
 *   2. Wireshark `manuf`        — curated; fills gaps, adds /28 /36 (wireshark.org)
 *   3. Nmap nmap-mac-prefixes   — fills remaining 24-bit gaps (nmap.org)
 *
 * Writes:
 *   oui-registry.json       — 24-bit OUI (6 hex)  → vendor  (drop-in, unchanged shape)
 *   oui-registry-fine.json  — 28/36-bit (7/9 hex) → vendor  (longest-prefix matches)
 *
 * Run:  npm run oui:refresh
 * Needs internet — run dashboard-side (refresh as a periodic maintenance task),
 * NOT on the air-gapped sensor. Aborts without writing if the IEEE MA-L base
 * fails to download, so a network blip can never clobber the existing registry.
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT_24 = join(DIR, "oui-registry.json");
const OUT_FINE = join(DIR, "oui-registry-fine.json");

const SOURCES = {
  ieeeMaL: "https://standards-oui.ieee.org/oui/oui.csv",
  ieeeMaM: "https://standards-oui.ieee.org/oui28/mam.csv",
  ieeeMaS: "https://standards-oui.ieee.org/oui36/oui36.csv",
  wireshark: "https://www.wireshark.org/download/automated/data/manuf",
  nmap: "https://raw.githubusercontent.com/nmap/nmap/master/nmap-mac-prefixes",
};

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "netmon-oui-refresh" } });
    if (!res.ok) {
      console.warn(`  ! ${url} → HTTP ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (e) {
    console.warn(`  ! ${url} → ${(e as Error).message}`);
    return null;
  }
}

/** Minimal CSV line splitter — handles quoted fields and "" escapes. */
function csvFields(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          q = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      q = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

const hex = (s: string) => s.replace(/[^0-9a-fA-F]/g, "").toUpperCase();

interface Maps {
  c24: Map<string, string>;
  fine: Map<string, string>;
}

/** First writer wins, so load sources in precedence order. */
function add(m: Maps, prefix: string, vendor: string): void {
  const p = hex(prefix);
  const v = vendor.trim();
  if (!v) return;
  if (p.length === 6) {
    if (!m.c24.has(p)) m.c24.set(p, v);
  } else if (p.length === 7 || p.length === 9) {
    if (!m.fine.has(p)) m.fine.set(p, v);
  }
}

/** IEEE CSV: columns are Registry,Assignment,Organization Name,Organization Address. */
function loadIeee(m: Maps, csv: string): void {
  const lines = csv.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = csvFields(lines[i]);
    if (f.length < 3) continue;
    if (f[1] && f[2]) add(m, f[1], f[2]);
  }
}

/** Wireshark manuf: TAB-separated `prefix[/mask] <short> [long]`; `#` comments. */
function loadWireshark(m: Maps, txt: string): void {
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split("\t").map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    let prefix = parts[0];
    const vendor = parts[2] || parts[1]; // prefer the long name
    let bits = 24;
    const slash = prefix.indexOf("/");
    if (slash >= 0) {
      bits = parseInt(prefix.slice(slash + 1), 10) || 24;
      prefix = prefix.slice(0, slash);
    }
    const h = hex(prefix);
    const key = bits <= 24 ? h.slice(0, 6) : bits <= 28 ? h.slice(0, 7) : h.slice(0, 9);
    add(m, key, vendor);
  }
}

/** Nmap nmap-mac-prefixes: `<6 hex> <vendor>`; `#` comments. */
function loadNmap(m: Maps, txt: string): void {
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const mm = line.match(/^([0-9A-Fa-f]{6})\s+(.+)$/);
    if (mm) add(m, mm[1], mm[2]);
  }
}

/** Stable, one-entry-per-line JSON (sorted keys) for clean git diffs. */
function writeSorted(path: string, map: Map<string, string>): void {
  const body = [...map.keys()]
    .sort()
    .map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(map.get(k)!)}`)
    .join(",\n");
  writeFileSync(path, `{\n${body}\n}\n`);
}

async function main(): Promise<void> {
  console.log("Refreshing OUI registries…");
  const m: Maps = { c24: new Map(), fine: new Map() };

  console.log("• IEEE MA-L …");
  const maL = await fetchText(SOURCES.ieeeMaL);
  if (!maL) {
    console.error("FATAL: IEEE MA-L download failed; keeping the existing registry.");
    process.exit(1);
  }
  loadIeee(m, maL);
  if (m.c24.size < 10000) {
    console.error(`FATAL: only ${m.c24.size} MA-L entries parsed (expected ~38k); aborting so we don't clobber good data.`);
    process.exit(1);
  }
  const baseMaL = m.c24.size;

  console.log("• IEEE MA-M / MA-S …");
  const maM = await fetchText(SOURCES.ieeeMaM);
  if (maM) loadIeee(m, maM);
  const maS = await fetchText(SOURCES.ieeeMaS);
  if (maS) loadIeee(m, maS);

  console.log("• Wireshark manuf …");
  const ws = await fetchText(SOURCES.wireshark);
  if (ws) loadWireshark(m, ws);
  const afterWs = m.c24.size;

  console.log("• Nmap prefixes …");
  const nmap = await fetchText(SOURCES.nmap);
  if (nmap) loadNmap(m, nmap);
  const afterNmap = m.c24.size;

  const prev = existsSync(OUT_24)
    ? Object.keys(JSON.parse(readFileSync(OUT_24, "utf8")) as Record<string, string>).length
    : 0;

  writeSorted(OUT_24, m.c24);
  writeSorted(OUT_FINE, m.fine);

  console.log("\nDone:");
  console.log(
    `  24-bit OUI : ${m.c24.size} (was ${prev}) — ${baseMaL} from IEEE MA-L, ` +
      `+${afterWs - baseMaL} Wireshark, +${afterNmap - afterWs} Nmap`,
  );
  console.log(`  fine 28/36 : ${m.fine.size} (MA-M/MA-S + Wireshark /28 /36)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
