/**
 * System-prompt assembly for the in-app assistant (M4 — tool-calling).
 *
 *   [ persona ]        ← editable in Settings → AI (blank → DEFAULT_PERSONA).
 *   [ tool rules ]     ← ALWAYS applied (use tools, don't guess, no false agreeing).
 *   [ app primer ]     ← ALWAYS applied (factual "how NetMon works").
 *   [ accessible sites ] + [ current page ] ← so the model has the school_ids.
 *
 * Data itself is no longer embedded — the model fetches it on demand via the
 * district-scoped tools (src/lib/ai/chat-tools.ts).
 */
import "server-only";

/** Default persona; also the placeholder shown in the settings textarea. */
export const DEFAULT_PERSONA = [
  "You are NetMon Assistant, a senior network engineer helping K-12 school district IT staff.",
  "You are embedded in NetMon, a network discovery + health dashboard. Be concise, practical,",
  "and specific. Use plain language a busy technician can act on. It's fine to ask a clarifying",
  "question or to tell the user which page to open for the data they want.",
].join(" ");

// Always enforced regardless of the editable persona.
const TOOL_RULES = [
  "## How to answer (always)",
  "- Use the provided TOOLS to look up real data (sites, device counts, device search, scan",
  "  history, findings). Do not answer site-specific questions from memory.",
  "- Call list_sites if you don't already have the right school_id.",
  "- State ONLY what the tools return. If a tool returns nothing, say so — do NOT guess or fill gaps.",
  "- NEVER agree with a number or claim the user asserts unless a tool confirms it; if you can't",
  "  verify it, say you can't see it in the data.",
  "- Device-type counts are only as good as classification. If a count seems off (e.g. far fewer",
  "  APs than expected), note that some devices may currently be classified as another type.",
].join("\n");

const APP_PRIMER = [
  "## About NetMon (so you can answer how it works)",
  "- Sensors on each school network run periodic scans (SNMP, DHCP, DNS, LLDP/CDP, STP) and",
  "  bundle the results; the dashboard ingests those bundles. Data is Districts → Schools → Sensors.",
  "- The Network map shows physical topology: LLDP/CDP build the switch backbone, and leaf devices",
  "  attach to a switch port via the bridge forwarding table. Devices behind switches that do NOT",
  "  answer SNMP are invisible, so device inventory is a LOWER BOUND where SNMP coverage is missing.",
  "- Device types are auto-classified by fusing signals (SNMP, DHCP option 55/60, LLDP, hostname,",
  "  MAC OUI vendor) into a confidence score; low-confidence ones can be AI-reviewed or human-confirmed.",
  "- Data is a point-in-time picture from the most recent scans; scan history is available per day.",
].join("\n");

export interface PromptSite {
  id: number;
  name: string;
  districtName: string;
}

export function buildAssistantSystemPrompt(opts: {
  instructions?: string | null;
  sites: PromptSite[];
  current?: { schoolId: number | null; label: string } | null;
}): string {
  const persona = opts.instructions && opts.instructions.trim() ? opts.instructions.trim() : DEFAULT_PERSONA;
  const parts: string[] = [persona, "", TOOL_RULES, "", APP_PRIMER];

  if (opts.sites.length > 0) {
    const list = opts.sites
      .slice(0, 250)
      .map((s) => `- ${s.name} (${s.districtName}) → school_id ${s.id}`)
      .join("\n");
    parts.push(
      "",
      "## Sites you can access (use these school_id values with the tools)",
      list,
    );
    if (opts.sites.length > 250) parts.push(`…and ${opts.sites.length - 250} more (use list_sites).`);
  } else {
    parts.push("", "## You currently have access to no sites with data.");
  }

  if (opts.current) {
    parts.push(
      "",
      `## The user is viewing: ${opts.current.label}${
        opts.current.schoolId ? ` (school_id ${opts.current.schoolId})` : ""
      }. Default to this site unless they ask about another.`,
    );
  }

  return parts.join("\n");
}
