import { metered_model } from "./mission-metering";
import { createOpenAI } from "@ai-sdk/openai";
import { APICallError, isStepCount, streamText, type LanguageModelUsage, type ToolSet } from "ai";
import type { TAttempt, TModelCandidate, TModelProviders, TModelStep, TToolProviders } from "../types/ai";

export const make_attempt = (candidate: TModelCandidate, outcome: TAttempt["outcome"], usage?: LanguageModelUsage): TAttempt => {
  const input_tokens = usage?.inputTokens;
  const cached_input_tokens = usage?.inputTokenDetails.cacheReadTokens;
  const output_tokens = usage?.outputTokens;
  const rates = candidate.pricing;
  let estimated_usd = null;
  if (rates && input_tokens !== undefined && output_tokens !== undefined &&
      (cached_input_tokens !== undefined || rates.input === rates.cached_input)) {
    const cached = cached_input_tokens ?? 0;
    estimated_usd = ((input_tokens - cached) * rates.input + cached * rates.cached_input +
      output_tokens * rates.output) / 1_000_000;
  }
  return {
    provider: candidate.provider, model: candidate.model, outcome,
    usage: usage && { input_tokens, cached_input_tokens, output_tokens, reasoning_tokens: usage.outputTokenDetails.reasoningTokens },
    estimated_usd, pricing_version: rates?.version,
  };
};

const select_tools = (candidate: TModelCandidate, registry: TToolProviders): ToolSet => {
  const tools: ToolSet = {};
  for (const name of candidate.tool_providers) {
    Object.assign(tools, registry[name]);
  }
  return tools;
};

export const create_model_step = (
  candidates: readonly TModelCandidate[],
  providers: TModelProviders = { openai: createOpenAI() },
): TModelStep => {
  if (!candidates.length) throw new Error("Configure at least one OpenAI model");
  return async ({ instructions, ephemeral, parallel_tool_calls, messages, tool_providers, signal, on_text, on_attempt }) => {
    for (const [index, candidate] of candidates.entries()) {
      signal.throwIfAborted();
      let exposed = false;
      let usage: LanguageModelUsage | undefined;
      let result: Awaited<ReturnType<TModelStep>>;
      try {
        const response = streamText({
          model: metered_model(candidate, providers[candidate.provider](candidate.model)),
          instructions,
          messages,
          tools: select_tools(candidate, tool_providers),
          abortSignal: signal,
          providerOptions: { openai: { ...(ephemeral && { store: false }), parallelToolCalls: parallel_tool_calls } },
          maxRetries: 0,
          maxOutputTokens: candidate.max_output_tokens,
          temperature: candidate.temperature,
          stopWhen: isStepCount(1),
          // The full-stream consumer records errors without logging host prompts.
          onError: () => {},
        });
        for await (const part of response.fullStream) {
          if (part.type === "text-delta") {
            exposed = true;
            on_text(part.text);
          }
          if (part.type === "tool-input-start" || part.type === "tool-call") exposed = true;
          if (part.type === "finish-step") usage = part.usage;
          if (part.type === "error") throw part.error;
          if (part.type === "abort") throw new Error("Model step aborted");
        }
        const finish = await response.finishReason;
        if (finish !== "stop" && finish !== "tool-calls") throw new Error("Incomplete model step: " + finish);
        result = { messages: (await response.response).messages, continue_with_tools: (await response.toolCalls).length > 0 };
      } catch (error) {
        on_attempt(make_attempt(candidate, "failed", usage));
        if (exposed || signal.aborted || !APICallError.isInstance(error) ||
            !error.isRetryable || index === candidates.length - 1) throw error;
        continue;
      }
      on_attempt(make_attempt(candidate, "completed", usage));
      return result;
    }
    throw new Error("OpenAI model candidates exhausted");
  };
};
