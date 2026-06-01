/**
 * Best-effort cost estimation from token counts. Prices are USD per 1M tokens
 * and are APPROXIMATE — they drift; treat the resulting cost as indicative, not
 * billing-grade. An unknown model returns null (we show "—" rather than a wrong
 * number). Matching is by substring so dated model ids (e.g. "gpt-4o-2024-08-06")
 * still resolve.
 *
 * Update this table when you change models or when vendor pricing changes.
 */
interface Price {
  inPerM: number;
  outPerM: number;
}

// Ordered: first substring match wins, so put more specific keys first.
const PRICES: [match: string, price: Price][] = [
  // OpenAI / Azure OpenAI
  ["gpt-4o-mini", { inPerM: 0.15, outPerM: 0.6 }],
  ["gpt-4o", { inPerM: 2.5, outPerM: 10 }],
  ["gpt-4.1-mini", { inPerM: 0.4, outPerM: 1.6 }],
  ["gpt-4.1", { inPerM: 2.0, outPerM: 8 }],
  ["o4-mini", { inPerM: 1.1, outPerM: 4.4 }],
  ["o3-mini", { inPerM: 1.1, outPerM: 4.4 }],
  ["o3", { inPerM: 2.0, outPerM: 8 }],
  // Anthropic Claude
  ["claude-opus", { inPerM: 15, outPerM: 75 }],
  ["claude-sonnet", { inPerM: 3, outPerM: 15 }],
  ["claude-haiku", { inPerM: 1, outPerM: 5 }],
];

function priceFor(model: string | null | undefined): Price | null {
  if (!model) return null;
  const m = model.toLowerCase();
  for (const [match, price] of PRICES) {
    if (m.includes(match)) return price;
  }
  return null;
}

/** Estimated USD cost for a single call, or null if the model price is unknown. */
export function estimateCost(
  model: string | null | undefined,
  tokensIn: number | null,
  tokensOut: number | null,
): number | null {
  const price = priceFor(model);
  if (!price) return null;
  const inCost = ((tokensIn ?? 0) / 1_000_000) * price.inPerM;
  const outCost = ((tokensOut ?? 0) / 1_000_000) * price.outPerM;
  return Math.round((inCost + outCost) * 1e6) / 1e6; // round to 6 dp
}
