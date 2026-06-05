/**
 * In-app assistant chat — a multi-turn completion against the active provider,
 * routed through the SAME limiter as the analysis sweep (shared TPM budget, 429
 * backoff). Prefers Azure (in-tenant). Used by src/lib/ai/chat-actions.ts.
 *
 * No `server-only` so it stays importable wherever the AI seam is (matches the
 * rest of src/lib/ai).
 */
import type {
  AiToolDef,
  AiToolExecutor,
  ChatMessage,
  CompletionResult,
} from "./types";
import { activeProviders } from "./providers/registry";
import { schedule, noteRateLimit, retryAfterSeconds } from "./limiter";

export interface AiChatResult extends CompletionResult {
  providerId: string;
}

/** A stored chat turn, shaped for the client UI. */
export interface ChatMsg {
  id: number;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
}

export async function aiChat(
  input: { system: string; messages: ChatMessage[] },
  opts?: { maxOutputTokens?: number },
): Promise<AiChatResult> {
  const active = await activeProviders();
  if (active.length === 0) {
    throw new Error("No AI provider is enabled. Configure one in Settings → AI.");
  }
  const chosen = active.find((a) => a.provider.id === "azure-openai") ?? active[0];
  const { provider, config } = chosen;
  const maxOutputTokens = opts?.maxOutputTokens ?? 1024;

  try {
    const r = await schedule(() => provider.chat(input, config, { maxOutputTokens }));
    return { ...r, providerId: provider.id };
  } catch (err) {
    const ra = retryAfterSeconds(err);
    if (ra) noteRateLimit(ra);
    throw err;
  }
}

/** Agentic chat: the model may call `tools` (run via `execute`) before answering.
 *  Falls back to plain chat() for a provider without tool support. */
export async function aiChatWithTools(
  input: {
    system: string;
    messages: ChatMessage[];
    tools: AiToolDef[];
    execute: AiToolExecutor;
  },
  opts?: { maxOutputTokens?: number },
): Promise<AiChatResult> {
  const active = await activeProviders();
  if (active.length === 0) {
    throw new Error("No AI provider is enabled. Configure one in Settings → AI.");
  }
  const chosen = active.find((a) => a.provider.id === "azure-openai") ?? active[0];
  const { provider, config } = chosen;
  const maxOutputTokens = opts?.maxOutputTokens ?? 1024;

  try {
    if (provider.chatWithTools) {
      const r = await schedule(() =>
        provider.chatWithTools!(input, config, { maxOutputTokens }),
      );
      return { ...r, providerId: provider.id };
    }
    // No tool support on this provider — answer without tools.
    const r = await schedule(() =>
      provider.chat({ system: input.system, messages: input.messages }, config, {
        maxOutputTokens,
      }),
    );
    return { ...r, providerId: provider.id };
  } catch (err) {
    const ra = retryAfterSeconds(err);
    if (ra) noteRateLimit(ra);
    throw err;
  }
}
