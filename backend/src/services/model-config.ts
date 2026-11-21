import { z } from "zod";
import type { TModelCandidate, TModelPurpose } from "../types/ai";

export const model_config_schema = z.strictObject({
  provider: z.literal("openai"),
  purposes: z.array(z.enum(["interview", "research", "planning", "live", "chat"])).min(1).optional(),
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

export const configured_models = (config = process.env.OPENAI_TEXT_MODELS): TModelCandidate[] => {
  if (!config?.trim()) return [];
  return z.array(model_config_schema).parse(JSON.parse(config));
};

export const configured_models_for = (purpose: TModelPurpose, config = process.env.OPENAI_TEXT_MODELS): TModelCandidate[] => {
  const models = configured_models(config);
  const selected = models.filter(model => model.purposes?.includes(purpose));
  return [...selected, ...models.filter(model => model.purposes === undefined)];
};
