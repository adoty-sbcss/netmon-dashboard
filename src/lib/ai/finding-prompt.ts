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
    `\nDo this in order, using your real-data tools (search_devices, site_findings, ` +
    `list_scans, device_counts, list_sites) — don't answer generically:\n` +
    `1. LOCATE it: find the exact device(s) or evidence involved and tell me precisely ` +
    `where they are — IP, MAC, vendor/model, the school, and the subnet or switch/port ` +
    `if the data has it. (For a device finding like "MikroTik device," search the device ` +
    `inventory by that vendor/name.)\n` +
    `2. CONFIRM it from the data, or say plainly if you can't find it.\n` +
    `3. FIX it: concrete steps for THIS network, referencing the specific devices you found.\n` +
    `4. Flag anything related worth checking.`
  );
}
