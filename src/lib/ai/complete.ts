/**
 * Generic single model completion against the active provider — the seam used by
 * non-analysis AI features (currently device-type adjudication, src/lib/classify).
 *
 * Routes through the SAME rate limiter as the analysis sweep (src/lib/ai/limiter),
 * so classification calls and analysis calls share one pacing budget against the
 * Azure OpenAI TPM quota and a 429 in either backs everything off. Prefers the
 * Azure provider (data stays in-tenant) when more than one is enabled.
 *
 * No `server-only`: the cron Job imports it under tsx.
 */
import { activeProviders } from "./providers/registry";
import { schedule, noteRateLimit, retryAfterSeconds } from "./limiter";

export interface AiCompleteResult {
  text: string;
  model: string;
  providerId: string;
  tokensIn: number | null;
  tokensOut: number | null;
}

/**
 * Run one completion (instructions → system, context → user) and return the raw
 * text. Defaults to a small output budget + JSON mode (classification verdicts are
 * tiny). Throws if no provider is enabled.
 */
export async function aiComplete(
  prompt: { instructions: string; context: string },
  opts?: { maxOutputTokens?: number; json?: boolean },
): Promise<AiCompleteResult> {
  const active = await activeProviders();
  if (active.length === 0) {
    throw new Error("No AI provider is enabled/configured.");
  }
  // Prefer Azure OpenAI (in-tenant) when present; else the first active provider.
  const chosen = active.find((a) => a.provider.id === "azure-openai") ?? active[0];
  const { provider, config } = chosen;

  const maxOutputTokens = opts?.maxOutputTokens ?? 600;
  const json = opts?.json ?? true;

  try {
    const r = await schedule(() =>
      provider.complete(
        { system: prompt.instructions, user: prompt.context },
        config,
        { maxOutputTokens, json },
      ),
    );
    return { ...r, providerId: provider.id };
  } catch (err) {
    const ra = retryAfterSeconds(err);
    if (ra) noteRateLimit(ra);
    throw err;
  }
}
