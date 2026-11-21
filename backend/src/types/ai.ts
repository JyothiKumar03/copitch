import type { LanguageModel, ModelMessage, ToolSet } from "ai";
import type { z } from "zod";
import type { model_config_schema } from "../services/model-config";

export type TModelCandidate = z.infer<typeof model_config_schema>;
export type TToolProviders = Partial<Record<TModelCandidate["tool_providers"][number], ToolSet>>;
export type TModelProviders = Record<TModelCandidate["provider"], (model: string) => LanguageModel>;

export type TAttempt = {
  provider: TModelCandidate["provider"];
  model: string;
  outcome: "completed" | "failed";
  usage?: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number; reasoning_tokens?: number };
  estimated_usd: number | null;
  pricing_version?: string;
};

export type TStepRequest = {
  instructions?: string;
  messages: ModelMessage[];
  tool_providers: TToolProviders;
  signal: AbortSignal;
  on_text: (text: string) => void;
  on_attempt: (attempt: TAttempt) => void;
};

export type TModelStep = (request: TStepRequest) => Promise<{
  messages: ModelMessage[];
  continue_with_tools: boolean;
}>;
