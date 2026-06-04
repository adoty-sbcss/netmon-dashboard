/**
 * refresh-dhcp-fingerprints.ts — regenerate the DHCP option-55 fingerprint map.
 *
 * Source: the legacy, OPEN (ODbL 1.0 + DbCL 1.0) Fingerbank `dhcp_fingerprints.conf`
 * (the 2014 v6.8.2 dataset — see docs/WISHLIST.md "Fingerbank decision"). It's an
 * INI-style file: each section header is a DHCP option-55 fingerprint and carries a
 * `description`. We map the description to one of our DeviceType buckets and write
 * src/lib/oui/dhcp-fingerprints.json (fingerprint → type).
 *
 * Run:  npm run dhcp:refresh   (needs internet; dashboard-side, not the sensor)
 *
 * ODbL attribution: contains data from the Fingerbank open DHCP fingerprints
 * database, © Inverse inc., licensed under ODbL 1.0 / DbCL 1.0. The data is the
 * stale 2014 snapshot; the AI adjudicator covers the gap for newer devices.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT = join(DIR, "dhcp-fingerprints.json");

// ODbL/DbCL mirror of the legacy Fingerbank conf (the canonical PacketFence path
// also works; the karottc mirror carries the explicit open-license header).
const SOURCE = "https://raw.githubusercontent.com/karottc/fingerbank/master/dhcp_fingerprints.conf";

/** Map a Fingerbank description string to one of our DeviceType buckets, or null. */
function descriptionToType(desc: string): string | null {
  const d = desc.toLowerCase();
  if (/printer|jetdirect|laserjet|officejet|copier|\bmfp\b/.test(d)) return "printer";
  if (/voip|\bphone\b|polycom|yealink|grandstream|\bsip\b|spectralink/.test(d)) return "phone";
  if (/camera|\bnvr\b|\bdvr\b|surveillance/.test(d)) return "camera";
  if (/iphone|ipad|ipod|android|\bios\b|mobile|tablet|blackberry|windows phone|symbian/.test(d))
    return "mobile";
  if (/router|gateway|\bisr\b|\basr\b|mikrotik|routeros/.test(d)) return "router";
  if (/firewall|fortigate|palo alto|sonicwall|\basa\b/.test(d)) return "firewall";
  if (/access point|\bap\b|aironet|wireless|meraki|aruba|ubiquiti/.test(d)) return "ap";
  if (/\bswitch\b|catalyst|procurve/.test(d)) return "switch";
  if (/\bnas\b|synology|qnap|storage|\bsan\b/.test(d)) return "storage";
  if (
    /windows|macintosh|mac ?os|\bos x\b|linux|ubuntu|debian|fedora|centos|chrome ?os|chromebook|workstation|desktop|laptop|\bvm\b|vmware|server/.test(
      d,
    )
  )
    return "computer";
  return null;
}

const normKey = (s: string) => (s.match(/\d+/g) ?? []).join(",");

async function main(): Promise<void> {
  console.log("Refreshing DHCP option-55 fingerprints…");
  let txt: string;
  try {
    const res = await fetch(SOURCE, { headers: { "User-Agent": "netmon-dhcp-refresh" } });
    if (!res.ok) {
      console.error(`FATAL: ${SOURCE} → HTTP ${res.status}; keeping existing map.`);
      process.exit(1);
    }
    txt = await res.text();
  } catch (e) {
    console.error(`FATAL: download failed (${(e as Error).message}); keeping existing map.`);
    process.exit(1);
  }

  const map = new Map<string, string>();
  let current: string | null = null;
  let sections = 0;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const header = line.match(/^\[(.+?)\]$/);
    if (header) {
      current = normKey(header[1]);
      if (current) sections++;
      continue;
    }
    if (!current) continue;
    const kv = line.match(/^description\s*=\s*(.+)$/i);
    if (kv) {
      const type = descriptionToType(kv[1]);
      if (type && !map.has(current)) map.set(current, type);
      current = null; // one description per section
    }
  }

  if (map.size < 50) {
    console.error(`FATAL: only ${map.size} fingerprints mapped (parse likely broke); aborting.`);
    process.exit(1);
  }

  const body = [...map.keys()]
    .sort()
    .map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(map.get(k)!)}`)
    .join(",\n");
  writeFileSync(OUT, `{\n${body}\n}\n`);

  console.log(`Done: ${map.size} option-55 fingerprints written (from ${sections} sections).`);
  console.log("Note: legacy ODbL data (~2014) — newer devices fall through to OUI/SNMP + the AI adjudicator.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
