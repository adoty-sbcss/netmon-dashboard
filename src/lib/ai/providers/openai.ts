/**
 * OpenAI (direct) provider — GPT via the OpenAI platform API (platform.openai.com),
 * billed to the org's API credits. Distinct from the Azure OpenAI column: same
 * model family, different account/billing, data goes to OpenAI rather than the
 * Azure tenant. Config: apiKey, model, optional organization/project/baseURL.
 */
import OpenAI from "openai";

import type {
  AiProvider,
  AnalysisInput,
  AiAnalysisResult,
  AnalyzeOptions,
  CompletionResult,
  ResolvedProviderConfig,
} from "../types";
import { ANALYSIS_OUTPUT_SCHEMA, normalizeOutput } from "../output-schema";

const MAX_RETRIES = Number(process.env.AI_MAX_RETRIES) || 4;

export const openAiProvider: AiProvider = {
  id: "openai",
  label: "GPT (OpenAI)",
  fields: {
    modelLabel: "Model",
    modelPlaceholder: "gpt-4o",
    needsEndpoint: false,
    needsApiVersion: false,
    needsOrgProject: true,
  },

  isConfigured(cfg: ResolvedProviderConfig): boolean {
    return Boolean(cfg.apiKey && cfg.model);
  },

  async analyze(
    input: AnalysisInput,
    cfg: ResolvedProviderConfig,
    opts: AnalyzeOptions,
  ): Promise<AiAnalysisResult> {
    if (!cfg.apiKey || !cfg.model) {
      throw new Error("OpenAI is not configured");
    }

    const client = new OpenAI({
      apiKey: cfg.apiKey,
      organization: cfg.organization || undefined,
      project: cfg.project || undefined,
      baseURL: cfg.baseURL || undefined,
      maxRetries: MAX_RETRIES,
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

  async complete(
    msg: { system: string; user: string },
    cfg: ResolvedProviderConfig,
    opts: { maxOutputTokens: number; json?: boolean },
  ): Promise<CompletionResult> {
    if (!cfg.apiKey || !cfg.model) throw new Error("OpenAI is not configured");
    const client = new OpenAI({
      apiKey: cfg.apiKey,
      organization: cfg.organization || undefined,
      project: cfg.project || undefined,
      baseURL: cfg.baseURL || undefined,
      maxRetries: MAX_RETRIES,
      timeout: 60_000,
    });
    const completion = await client.chat.completions.create({
      model: cfg.model,
      max_completion_tokens: opts.maxOutputTokens,
      messages: [
        { role: "system", content: msg.system },
        { role: "user", content: msg.user },
      ],
      ...(opts.json ? { response_format: { type: "json_object" as const } } : {}),
    });
    return {
      text: completion.choices[0]?.message?.content ?? "",
      model: completion.model || cfg.model,
      tokensIn: completion.usage?.prompt_tokens ?? null,
      tokensOut: completion.usage?.completion_tokens ?? null,
    };
  },
};
