import { z } from "zod";
import { MAX_PRESENTATION_SLIDES } from "../../../shared/presentation";
import { public_url } from "../services/research";
export type { TMission, TMissionStep, TMissionRetry, TMissionRetryPhase, TOutcomeContract } from "../../../shared/mission";

const text = z.string().trim().min(1).max(600);
const url = z.string().max(2048).refine(value => !!public_url(value), "Enter a public web address.");
const default_mission_budget_usd = 5;
const maximum_mission_budget_usd = 20;

export const configured_mission_budget_usd = () => {
  const raw = Number(process.env.MISSION_BUDGET_USD ?? default_mission_budget_usd);
  return Number.isFinite(raw) ? Math.min(maximum_mission_budget_usd, Math.max(default_mission_budget_usd, raw)) : default_mission_budget_usd;
};

export const contract_schema = z.strictObject({
  contract_id: z.uuid(), revision: z.number().int().positive(), subject: text, audience: text, purpose: text,
  deliverable: z.strictObject({ kind: z.literal("deck"), slide_count: z.union([z.literal("auto"), z.number().int().min(1).max(MAX_PRESENTATION_SLIDES)]),
    tone: text.optional(), max_minutes: z.number().int().min(1).max(60).optional() }),
  must_include: z.array(z.strictObject({ text, source: z.literal("host") })).max(24),
  sources: z.strictObject({ materials: z.string().max(30000).optional(), urls: z.array(url).max(8), files: z.array(z.uuid()).max(6), public_search: z.boolean(),
    site_tasks: z.array(z.strictObject({ url, goal: text, mode: z.enum(["read","interact"]) })).max(8) }),
  success_checks: z.array(text).max(12),
  budget: z.strictObject({ usd: z.number().positive().refine(value => value <= configured_mission_budget_usd(),
    "The plan exceeds the configured mission spending limit."), minutes: z.number().int().positive().max(10) }),
});
export const mission_revision = z.strictObject({ revision: z.number().int().positive() });
export const mission_revision_input = mission_revision.extend({ contract: contract_schema });

export const mission_turn_patch = z.strictObject({
  slide_count: z.number().int().min(1).max(MAX_PRESENTATION_SLIDES).optional(), audience: text.optional(),
  purpose: text.optional(), tone: text.optional(), add_host_fact: text.optional(), files_only: z.literal(true).optional(),
}).refine(value => Object.keys(value).length > 0,"Specify the requested change.");
export type TMissionTurnPatch = z.infer<typeof mission_turn_patch>;

export type TMissionDecision = { tool: "prepare_deck"; reason: string } |
  { tool: "ask_host"; gaps: string[]; transient?: "plan" | "review" } | { tool: "deliver" };
