/**
 * Drift guard for the remote-console allow-list (CON-7 audit, 2026-06-28).
 *
 * Two places in THIS repo hand-mirror the sensor's console command registries
 * (net_mon collector/src/collector/checkin.py is the source of truth):
 *   - broker/index.js            -> ALLOWED_CMDS         (the relay allow-list)
 *   - src/lib/admin/console-config.ts -> the OFFERED set (what the UI exposes)
 *
 * The bug this prevents: the dashboard offers a command (console-config) that the
 * broker does not relay (ALLOWED_CMDS), so it is silently rejected at the broker —
 * an availability bug, not a security hole. This asserts the two sets are exactly
 * equal. The broker's list is parsed out of broker/index.js as text on purpose, so
 * the production broker stays untouched (no import, no runtime/Dockerfile change).
 *
 * No DB, no browser, no server. Run with:
 *   npx tsx src/lib/admin/console-allowlist.validate.ts
 * Exits non-zero on any mismatch. Wired into CI (.github/workflows/ci.yml).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CONSOLE_COMMANDS,
  CONSOLE_CONTROL_COMMANDS,
  CONSOLE_OP_COMMANDS,
} from "./console-config";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  const tag = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`  [${tag}] ${name}${detail && !cond ? ` — ${detail}` : ""}`);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const brokerPath = path.resolve(here, "../../../broker/index.js");

/** Extract the string ids inside `ALLOWED_CMDS = new Set([ ... ])` in broker/index.js. */
function readBrokerAllowedCmds(): string[] {
  const src = fs.readFileSync(brokerPath, "utf8");
  const m = src.match(/ALLOWED_CMDS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  if (!m) {
    console.error(
      `FATAL: could not locate \`ALLOWED_CMDS = new Set([...])\` in ${brokerPath}. ` +
        `If the broker reformatted that declaration, update this parser.`,
    );
    process.exit(2);
  }
  const body = m[1].replace(/\/\/[^\n]*/g, ""); // drop // line comments first
  return [...body.matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
}

/** The exact set of ids the UI offers to send over a live console. */
const offeredIds = [
  ...CONSOLE_COMMANDS,
  ...CONSOLE_CONTROL_COMMANDS,
  ...CONSOLE_OP_COMMANDS,
].map((c) => c.id);

const brokerIds = readBrokerAllowedCmds();

const offered = new Set(offeredIds);
const broker = new Set(brokerIds);
const offeredNotRelayed = [...offered].filter((id) => !broker.has(id)).sort(); // the named bug
const relayedNotOffered = [...broker].filter((id) => !offered.has(id)).sort(); // dead allow-list entry

console.log("NetMon remote-console allow-list — drift check");
console.log(`  broker ALLOWED_CMDS: ${broker.size} ids`);
console.log(`  dashboard offers:    ${offered.size} ids\n`);

check("no duplicate ids in the offered set", offered.size === offeredIds.length);
check("no duplicate ids in the broker set", broker.size === brokerIds.length);
check(
  "every command the dashboard OFFERS is relayed by the broker",
  offeredNotRelayed.length === 0,
  `offered-but-rejected: ${JSON.stringify(offeredNotRelayed)}`,
);
check(
  "the broker allow-list has no dead entries the UI never offers",
  relayedNotOffered.length === 0,
  `relayed-but-not-offered: ${JSON.stringify(relayedNotOffered)}`,
);

if (failures) {
  console.log(
    `\n${failures} CHECK(S) FAILED — broker/index.js ALLOWED_CMDS and ` +
      `src/lib/admin/console-config.ts have drifted.\n` +
      `Both must mirror the sensor registries (net_mon checkin.py; canonical list: ` +
      `net_mon collector/console_broker_allowlist.json). Reconcile the two lists.`,
  );
} else {
  console.log("\nALL CHECKS PASSED — broker relays exactly what the dashboard offers.");
}
process.exit(failures === 0 ? 0 : 1);
