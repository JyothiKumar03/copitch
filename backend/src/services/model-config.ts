import { z } from "zod";
import type { TModelCandidate, TModelPurpose } from "../types/ai";

export const model_config_schema = z.strictObject({
  provider: z.literal("openai"),
  purposes: z.array(z.enum(["interview", "research", "planning", "live", "chat", "director", "browse"])).min(1).optional(),
  model: z.string().trim().min(1),
  max_output_tokens: z.number().int().positive(),
  temperature: z.number().min(0).max(2).optional(),
  tool_providers: z.array(z.literal("session")).default(["session"]),
  pricing: z.strictObject({
    input: z.number().nonnegative(),
    cached_input: z.number().nonnegative(),
    output: z.number().nonnegative(),
    version: z.string().trim().min(1),
  }).optional(),
});

// OpenAI standard-tier USD per 1M tokens (short context), from developers.openai.com/api/docs/pricing on 2026-11-22.
const price_version = "openai-standard-2026-11-22";
export const model_prices: Record<string, NonNullable<TModelCandidate["pricing"]>> = {
  "gpt-5.6-luna": { input: 0.20, cached_input: 0.02, output: 1.20, version: price_version },
  "gpt-5.4-mini": { input: 0.75, cached_input: 0.075, output: 4.50, version: price_version },
  "gpt-5.4": { input: 2.50, cached_input: 0.25, output: 15.00, version: price_version },
  "gpt-5.5": { input: 5.00, cached_input: 0.50, output: 30.00, version: price_version },
};

// Used when OPENAI_TEXT_MODELS is unset or empty. The env var, when set, replaces this list.
export const default_models: TModelCandidate[] = [
  { provider: "openai", model: "gpt-5.6-luna", max_output_tokens: 4096, tool_providers: ["session"], purposes: ["director", "browse"] },
  { provider: "openai", model: "gpt-5.4-mini", max_output_tokens: 4096, tool_providers: ["session"] },
];

export const configured_models = (config = process.env.OPENAI_TEXT_MODELS): TModelCandidate[] => {
  const parsed = config?.trim() ? z.array(model_config_schema).parse(JSON.parse(config)) : [];
  const models = parsed.length ? parsed : default_models;
  // An entry without its own pricing takes the known price for its model, so missions and the site agent can meter it.
  return models.map(model => model.pricing || !model_prices[model.model] ? model : { ...model, pricing: model_prices[model.model] });
};

export const configured_models_for = (purpose: TModelPurpose, config = process.env.OPENAI_TEXT_MODELS): TModelCandidate[] => {
  const models = configured_models(config);
  const selected = models.filter(model => model.purposes?.includes(purpose));
  return [...selected, ...models.filter(model => model.purposes === undefined)];
};
