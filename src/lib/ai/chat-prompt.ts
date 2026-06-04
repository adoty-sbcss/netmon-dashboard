/**
 * System-prompt assembly for the in-app assistant: a networking-expert persona,
 * a primer on what NetMon is and how to read it (so the model can answer "how
 * does the app work" questions), and the current scope's data snapshot (so it
 * answers grounded in real data). Phase 1 = scoped snapshot, no tools.
 */
import "server-only";

import { buildAnalysisContext } from "./context";
import type { AnalysisScope } from "./types";

const PERSONA = [
  "You are NetMon Assistant, a senior network engineer helping K-12 school district IT staff.",
  "You are embedded in NetMon, a network discovery + health dashboard. Be concise, practical,",
  "and specific. Use plain language a busy technician can act on. When you state a fact about",
  "this site, ground it in the DATA SNAPSHOT below and say what it's based on; if the snapshot",
  "doesn't cover something, say so rather than guessing. It's fine to ask a clarifying question.",
].join(" ");

const APP_PRIMER = [
  "## About NetMon (so you can answer how it works)",
  "- Sensors on each school network run periodic scans (SNMP, DHCP, DNS, LLDP/CDP, STP) and",
  "  bundle the results; the dashboard ingests those bundles. Data is organized as Districts →",
  "  Schools → Sensors.",
  "- The Network map shows physical topology: LLDP/CDP build the switch backbone, and leaf",
  "  devices attach to a switch port via the bridge forwarding table. Devices behind switches",
  "  that do NOT answer SNMP are invisible, so the map is a LOWER BOUND wherever SNMP coverage",
  "  is missing — weight conclusions accordingly.",
  "- Device types are auto-classified by fusing signals (SNMP, DHCP option 55/60, LLDP,",
  "  hostname, MAC OUI vendor) into a confidence score; low-confidence ones can be reviewed by",
  "  AI or confirmed by a human.",
  "- Findings/Issues come from rule-based checks plus scheduled AI analysis (health + topology",
  "  review). 'Confidence' and 'needs review' reflect how strongly the evidence supports a call.",
  "- The data is a point-in-time picture from the most recent scans; it is not live.",
].join("\n");

/** Build the full system prompt for a scope: persona + app primer + data snapshot. */
export async function buildChatSystemPrompt(scope: AnalysisScope): Promise<string> {
  const now = new Date();
  const window = { start: new Date(now.getTime() - 24 * 60 * 60 * 1000), end: now };
  let snapshot: string;
  try {
    snapshot = await buildAnalysisContext(scope, window);
  } catch {
    snapshot = "(data snapshot unavailable)";
  }
  return [
    PERSONA,
    "",
    APP_PRIMER,
    "",
    `## Current scope: ${scope.label} (${scope.type})`,
    "## DATA SNAPSHOT (compact JSON from the latest scans for this scope)",
    snapshot,
  ].join("\n");
}
