/**
 * System-prompt assembly for the in-app assistant.
 *
 *   [ persona ]            ← editable in Settings → AI (superadmin); falls back to
 *                            DEFAULT_PERSONA when blank.
 *   [ grounding rules ]    ← ALWAYS appended, not editable (anti-hallucination).
 *   [ app primer ]         ← ALWAYS appended (factual "how NetMon works").
 *   [ data snapshot ]      ← the current page's scope, when a site is in view.
 *
 * M1/M2 = page-scoped snapshot + editable persona. M4 swaps the snapshot for
 * district-scoped tools.
 */
import "server-only";

import { buildAnalysisContext } from "./context";
import type { AnalysisScope } from "./types";

/** The default persona — used when the admin hasn't set custom instructions. Also
 *  the placeholder shown in the settings textarea (kept in sync there). */
export const DEFAULT_PERSONA = [
  "You are NetMon Assistant, a senior network engineer helping K-12 school district IT staff.",
  "You are embedded in NetMon, a network discovery + health dashboard. Be concise, practical,",
  "and specific. Use plain language a busy technician can act on. It's fine to ask a clarifying",
  "question or to tell the user which page to open for the data they want.",
].join(" ");

// Always enforced regardless of the editable persona, so custom instructions can
// never turn off the anti-hallucination behavior.
const GROUNDING = [
  "## Grounding rules (always apply)",
  "- State facts about a site ONLY from the DATA SNAPSHOT below; say what each claim is based on.",
  "- If the snapshot doesn't cover something, say so plainly — do NOT guess or fill gaps.",
  "- NEVER simply agree with a number or claim the user asserts unless the snapshot supports it;",
  "  if you can't verify it, say you can't see it in the current data.",
].join("\n");

const APP_PRIMER = [
  "## About NetMon (so you can answer how it works)",
  "- Sensors on each school network run periodic scans (SNMP, DHCP, DNS, LLDP/CDP, STP) and",
  "  bundle the results; the dashboard ingests those bundles. Data is Districts → Schools → Sensors.",
  "- The Network map shows physical topology: LLDP/CDP build the switch backbone, and leaf devices",
  "  attach to a switch port via the bridge forwarding table. Devices behind switches that do NOT",
  "  answer SNMP are invisible, so the map is a LOWER BOUND wherever SNMP coverage is missing.",
  "- Device types are auto-classified by fusing signals (SNMP, DHCP option 55/60, LLDP, hostname,",
  "  MAC OUI vendor) into a confidence score; low-confidence ones can be AI-reviewed or human-confirmed.",
  "- Findings/Issues come from rule-based checks plus scheduled AI analysis (health + topology review).",
  "- The data is a point-in-time picture from the most recent scans; it is not live.",
].join("\n");

/**
 * Build the system prompt. `scope` is the school/district the user is currently
 * viewing (and authorized for), or null when no site is in view. `instructions`
 * is the admin-edited persona (null/blank → DEFAULT_PERSONA).
 */
export async function buildAssistantSystemPrompt(
  scope: AnalysisScope | null,
  instructions?: string | null,
): Promise<string> {
  const persona = instructions && instructions.trim() ? instructions.trim() : DEFAULT_PERSONA;
  const parts: string[] = [persona, "", GROUNDING, "", APP_PRIMER];

  if (scope) {
    const now = new Date();
    const window = { start: new Date(now.getTime() - 24 * 60 * 60 * 1000), end: now };
    let snapshot: string;
    try {
      snapshot = await buildAnalysisContext(scope, window);
    } catch {
      snapshot = "(data snapshot unavailable)";
    }
    parts.push(
      "",
      `## Current scope: ${scope.label} (${scope.type})`,
      "## DATA SNAPSHOT (compact JSON from the latest scans for this scope)",
      snapshot,
    );
  } else {
    parts.push(
      "",
      "## No specific school or district is open right now.",
      "You have NO site data in view. Answer questions about how NetMon works. For data about a",
      "specific site, tell the user to open that school or district page and ask again.",
    );
  }

  return parts.join("\n");
}
