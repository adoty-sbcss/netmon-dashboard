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
  CompletionResult,
  ResolvedProviderConfig,
} from "../types";
import { ANALYSIS_OUTPUT_SCHEMA, normalizeOutput } from "../output-schema";

const DEFAULT_MODEL = "claude-opus-4-8";
const MAX_RETRIES = Number(process.env.AI_MAX_RETRIES) || 4;

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

    const client = new Anthropic({
      apiKey: cfg.apiKey,
      maxRetries: MAX_RETRIES,
      timeout: 60_000,
    });

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

  async complete(
    msg: { system: string; user: string },
    cfg: ResolvedProviderConfig,
    opts: { maxOutputTokens: number; json?: boolean },
  ): Promise<CompletionResult> {
    if (!cfg.apiKey) throw new Error("Anthropic is not configured");
    const model = cfg.model || DEFAULT_MODEL;
    const client = new Anthropic({
      apiKey: cfg.apiKey,
      maxRetries: MAX_RETRIES,
      timeout: 60_000,
    });
    // Anthropic has no JSON response mode; the prompt asks for JSON and the caller
    // extracts it. (opts.json is accepted for a uniform signature.)
    void opts.json;
    const message = await client.messages.create({
      model,
      max_tokens: opts.maxOutputTokens,
      system: msg.system,
      messages: [{ role: "user", content: msg.user }],
    });
    const text = message.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("");
    return {
      text,
      model: message.model || model,
      tokensIn: message.usage?.input_tokens ?? null,
      tokensOut: message.usage?.output_tokens ?? null,
    };
  },
};
