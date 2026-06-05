/**
 * Shared agentic tool-call loop for the OpenAI + Azure OpenAI providers (same
 * SDK shape). The model may emit tool_calls; we run each via `execute`, feed the
 * results back, and loop until it returns a final text answer (or we hit
 * maxIterations and ask once more without tools). Token usage is summed across
 * the round-trips.
 */
import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import type { AiToolDef, AiToolExecutor, ChatMessage, CompletionResult } from "../types";

const MAX_TOOL_RESULT_CHARS = 12_000;

export async function runOpenAiToolLoop(
  client: OpenAI,
  model: string,
  input: {
    system: string;
    messages: ChatMessage[];
    tools: AiToolDef[];
    execute: AiToolExecutor;
    maxIterations?: number;
  },
  maxOutputTokens: number,
): Promise<CompletionResult> {
  const maxIterations = input.maxIterations ?? 6;
  const msgs: ChatCompletionMessageParam[] = [
    { role: "system", content: input.system },
    ...input.messages.map((m) => ({ role: m.role, content: m.content })),
  ];
  const tools = input.tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  let tokensIn = 0;
  let tokensOut = 0;
  let usedModel = model;

  for (let i = 0; i < maxIterations; i++) {
    const resp = await client.chat.completions.create({
      model,
      max_completion_tokens: maxOutputTokens,
      messages: msgs,
      tools,
    });
    usedModel = resp.model || model;
    tokensIn += resp.usage?.prompt_tokens ?? 0;
    tokensOut += resp.usage?.completion_tokens ?? 0;

    const choice = resp.choices[0]?.message;
    if (!choice) break;

    const calls = choice.tool_calls ?? [];
    if (calls.length === 0) {
      return {
        text: choice.content ?? "",
        model: usedModel,
        tokensIn: tokensIn || null,
        tokensOut: tokensOut || null,
      };
    }

    // Record the assistant's tool-call turn, then each tool result.
    msgs.push({ role: "assistant", content: choice.content ?? null, tool_calls: calls });
    for (const tc of calls) {
      if (tc.type !== "function") continue;
      let result: string;
      try {
        const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        result = await input.execute(tc.function.name, args);
      } catch (e) {
        result = `Error: ${(e as Error).message}`;
      }
      msgs.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result.slice(0, MAX_TOOL_RESULT_CHARS),
      });
    }
  }

  // Out of iterations — one final answer with no further tool calls.
  const final = await client.chat.completions.create({
    model,
    max_completion_tokens: maxOutputTokens,
    messages: msgs,
  });
  return {
    text: final.choices[0]?.message?.content ?? "(stopped after several tool calls)",
    model: usedModel,
    tokensIn: (tokensIn + (final.usage?.prompt_tokens ?? 0)) || null,
    tokensOut: (tokensOut + (final.usage?.completion_tokens ?? 0)) || null,
  };
}
