/**
 * Azure OpenAI provider — GPT served from inside the Azure tenant (data does not
 * leave the tenant; the standing air-gap-leaning preference). Config comes from
 * the DB (settings UI) or env fallback, resolved by src/lib/ai/settings.ts:
 *   endpoint, apiKey, model (= deployment name), apiVersion.
 */
import { AzureOpenAI } from "openai";

import type {
  AiProvider,
  AnalysisInput,
  AiAnalysisResult,
  AnalyzeOptions,
  ResolvedProviderConfig,
} from "../types";
import { ANALYSIS_OUTPUT_SCHEMA, normalizeOutput } from "../output-schema";

export const azureOpenAiProvider: AiProvider = {
  id: "azure-openai",
  label: "GPT (Azure OpenAI)",
  fields: {
    modelLabel: "Deployment name",
    modelPlaceholder: "gpt-4o",
    needsEndpoint: true,
    needsApiVersion: true,
    needsOrgProject: false,
  },

  isConfigured(cfg: ResolvedProviderConfig): boolean {
    return Boolean(cfg.endpoint && cfg.apiKey && cfg.model);
  },

  async analyze(
    input: AnalysisInput,
    cfg: ResolvedProviderConfig,
    opts: AnalyzeOptions,
  ): Promise<AiAnalysisResult> {
    if (!cfg.endpoint || !cfg.apiKey || !cfg.model) {
      throw new Error("Azure OpenAI is not configured");
    }

    const client = new AzureOpenAI({
      endpoint: cfg.endpoint,
      apiKey: cfg.apiKey,
      apiVersion: cfg.apiVersion || "2024-10-21",
      deployment: cfg.model,
      // Azure 429s when the deployment's TPM is exceeded; the SDK backs off
      // honoring Retry-After. More retries = transient throttling self-heals.
      maxRetries: Number(process.env.AI_MAX_RETRIES) || 4,
      timeout: 60_000,
    });

    const started = Date.now();
    const completion = await client.chat.completions.create({
      model: cfg.model,
      max_completion_tokens: opts.maxOutputTokens,
      messages: [
        { role: "system", content: input.instructions },
        { role: "user", content: input.context },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "network_analysis",
          strict: true,
          schema: ANALYSIS_OUTPUT_SCHEMA,
        },
      },
    });
    const latencyMs = Date.now() - started;

    const content = completion.choices[0]?.message?.content ?? "";
    const { prose, findings } = normalizeOutput(content);

    return {
      providerId: this.id,
      model: completion.model || cfg.model,
      prose,
      findings,
      tokensIn: completion.usage?.prompt_tokens ?? null,
      tokensOut: completion.usage?.completion_tokens ?? null,
      latencyMs,
    };
  },
};
