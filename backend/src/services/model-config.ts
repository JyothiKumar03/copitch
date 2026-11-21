import { z } from "zod";
import type { TModelCandidate } from "../types/ai";

export const model_config_schema = z.strictObject({
  provider: z.literal("openai"),
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

export function configured_models(config = process.env.OPENAI_TEXT_MODELS): TModelCandidate[] {
  if (!config?.trim()) return [];
  return z.array(model_config_schema).parse(JSON.parse(config));
}
