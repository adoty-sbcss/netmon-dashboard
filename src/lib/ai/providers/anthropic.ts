/**
 * Anthropic (Claude) provider. Config: apiKey (console.anthropic.com, separate
 * from a Claude subscription) + model. Built now; lights up when a key is saved
 * in the settings UI (or ANTHROPIC_API_KEY env). Structured output is enforced
 * with a forced tool whose input_schema is the shared contract; the analyst
 * brief rides as a cached system block for cheap repeat runs.
 */
import Anthropic from "@anthropic-ai/sdk";

import type {
  AiProvider,
  AnalysisInput,
  AiAnalysisResult,
  AnalyzeOptions,
  ResolvedProviderConfig,
} from "../types";
import { ANALYSIS_OUTPUT_SCHEMA, normalizeOutput } from "../output-schema";

const DEFAULT_MODEL = "claude-opus-4-8";

export const anthropicProvider: AiProvider = {
  id: "anthropic",
  label: "Claude (Anthropic)",
  fields: {
    modelLabel: "Model",
    modelPlaceholder: DEFAULT_MODEL,
    needsEndpoint: false,
    needsApiVersion: false,
    needsOrgProject: false,
  },

  isConfigured(cfg: ResolvedProviderConfig): boolean {
    return Boolean(cfg.apiKey);
  },

  async analyze(
    input: AnalysisInput,
    cfg: ResolvedProviderConfig,
    opts: AnalyzeOptions,
  ): Promise<AiAnalysisResult> {
    if (!cfg.apiKey) throw new Error("Anthropic is not configured");
    const model = cfg.model || DEFAULT_MODEL;

    const client = new Anthropic({ apiKey: cfg.apiKey });

    const started = Date.now();
    const message = await client.messages.create({
      model,
      max_tokens: opts.maxOutputTokens,
      system: [
        {
          type: "text",
          text: input.instructions,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: input.context }],
      tools: [
        {
          name: "record_analysis",
          description:
            "Record the network analysis as structured findings plus a narrative summary.",
          input_schema: ANALYSIS_OUTPUT_SCHEMA as unknown as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: "record_analysis" },
    });
    const latencyMs = Date.now() - started;

    const toolUse = message.content.find((b) => b.type === "tool_use");
    const raw = toolUse && toolUse.type === "tool_use" ? toolUse.input : {};
    const { prose, findings } = normalizeOutput(raw);

    return {
      providerId: this.id,
      model: message.model || model,
      prose,
      findings,
      tokensIn: message.usage?.input_tokens ?? null,
      tokensOut: message.usage?.output_tokens ?? null,
      latencyMs,
    };
  },
};
