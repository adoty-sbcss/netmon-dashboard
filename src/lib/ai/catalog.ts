/**
 * Curated option catalog for the /settings/ai dropdowns (models, Azure API
 * versions, schedule presets).
 *
 * MAINTENANCE: this is the "product stack" list reviewed on the weekly dashboard
 * update. It is intentionally just a code constant — the settings UI always
 * offers an "Other…" choice, so a model/version that isn't in these lists yet is
 * NEVER blocking (you can type it in). Update here when vendors ship new models;
 * a normal commit + push deploys it.
 *
 * Pure constants only (no server-only imports) so both the server page and the
 * client form can read it.
 */
export interface CatalogOption {
  value: string;
  label: string;
}

/** Sentinel for the "Other… (type it in)" choice. */
export const OTHER_OPTION = "__other__";

/** Suggested models per provider. For Azure the field is the DEPLOYMENT name —
 *  these are the common names techs give deployments; "Other…" covers any. */
export const MODEL_OPTIONS: Record<string, CatalogOption[]> = {
  "azure-openai": [
    { value: "gpt-4o", label: "gpt-4o" },
    { value: "gpt-4o-mini", label: "gpt-4o-mini (cheaper)" },
    { value: "gpt-4.1", label: "gpt-4.1" },
    { value: "o4-mini", label: "o4-mini (reasoning)" },
  ],
  openai: [
    { value: "gpt-4o", label: "gpt-4o" },
    { value: "gpt-4o-mini", label: "gpt-4o-mini (cheaper)" },
    { value: "gpt-4.1", label: "gpt-4.1" },
    { value: "o4-mini", label: "o4-mini (reasoning)" },
  ],
  anthropic: [
    { value: "claude-opus-4-8", label: "Claude Opus 4.8 (most capable)" },
    { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5 (balanced)" },
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5 (cheapest)" },
  ],
};

export function modelOptionsFor(providerId: string): CatalogOption[] {
  return MODEL_OPTIONS[providerId] ?? [];
}

/** Azure OpenAI REST API versions. The GA default is first. */
export const AZURE_API_VERSIONS: CatalogOption[] = [
  { value: "2024-10-21", label: "2024-10-21 (GA, default)" },
  { value: "2025-01-01-preview", label: "2025-01-01-preview" },
  { value: "2024-12-01-preview", label: "2024-12-01-preview" },
  { value: "2024-08-01-preview", label: "2024-08-01-preview" },
];

/** Daily/weekly run schedules (cron, UTC). */
export const CRON_PRESETS: CatalogOption[] = [
  { value: "0 2 * * *", label: "Daily · 2:00 AM UTC (≈ 6–7 PM Pacific)" },
  { value: "0 5 * * *", label: "Daily · 5:00 AM UTC (≈ 9–10 PM Pacific)" },
  { value: "0 13 * * *", label: "Daily · 1:00 PM UTC (≈ 5–6 AM Pacific)" },
  { value: "0 2 * * 1", label: "Weekly · Monday 2:00 AM UTC" },
];
