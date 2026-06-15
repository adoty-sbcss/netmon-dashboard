/**
 * The "Help me fix this" prompt handed to the assistant from an AI finding card.
 * Findings store only text (no device link), so the value is making the assistant
 * USE its real-data tools to locate the actual device(s)/evidence on this site and
 * give grounded, specific steps — not a generic checklist. Shared so the overview
 * card and the full analysis page stay identical.
 */
export interface FindingForPrompt {
  title: string;
  severity: string;
  confidence?: string | null;
  detail?: string | null;
  evidence?: string | null;
  recommendation?: string | null;
}

export function buildFindingFixPrompt(f: FindingForPrompt): string {
  return (
    `I want to actually fix this NetMon AI finding on this site — not just read theory.\n\n` +
    `Title: ${f.title}\n` +
    `Severity: ${f.severity}${f.confidence ? ` (${f.confidence})` : ""}\n` +
    (f.detail ? `Detail: ${f.detail}\n` : "") +
    (f.evidence ? `Evidence: ${f.evidence}\n` : "") +
    (f.recommendation ? `Suggested next step: ${f.recommendation}\n` : "") +
    `\nImportant: this finding comes from the scheduled AI analysis, so it will NOT ` +
    `appear in your site_findings/issues tools — do NOT try to "find the finding" or ` +
    `reply that you can't locate it. The Detail/Evidence above IS the source of truth; ` +
    `work from it.\n\n` +
    `Do this in order, using your real-data tools — don't answer generically:\n` +
    `1. LOCATE the devices involved: pull the concrete identifiers out of the Detail/` +
    `Evidence above (IPs, MACs, vendor/model, names) and look them up.\n` +
    `   - Hosts/clients (a printer, a "MikroTik device", DHCP clients by MAC) -> ` +
    `search_devices (matches hostname/vendor/MAC/IP).\n` +
    `   - Switches / STP root bridges / uplinks / infrastructure -> search_switches ` +
    `(STP bridge IDs look like priority/.../<chassis-mac>; search the MAC part).\n` +
    `   Report exactly where each is: IP, MAC, model, the school, and subnet/port if known.\n` +
    `2. If a specific device isn't in the current inventory, say so briefly but KEEP GOING ` +
    `- still give the fix from the evidence; don't stop.\n` +
    `3. FIX it: concrete steps for THIS network, referencing the specific devices you found.\n` +
    `4. Flag anything related worth checking.`
  );
}
