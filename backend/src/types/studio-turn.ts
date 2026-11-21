import { z } from "zod";
import type { TSourcePolicy } from "./research";

export const turn_text_limit = 6000;
export const spoken_text_limit = 1600;
export const source_selection_limit = 6;
export const url_selection_limit = 8;
export const studio_language = z.string().max(35).refine(value => {
  try { return Intl.getCanonicalLocales(value).length === 1; }
  catch { return false; }
}, "Invalid language tag");
const source_policy_schema = z.enum(["files_only", "public_search"]);

export const studio_turn_input = z.strictObject({
  turn_id: z.uuid(), message: z.string().trim().min(1).max(turn_text_limit), input: z.enum(["typed", "speech"]),
  brief_id: z.uuid().optional(), source_policy: source_policy_schema.optional(),
  source_ids: z.array(z.uuid()).max(source_selection_limit).optional(),
  urls: z.array(z.string().max(2048)).max(url_selection_limit).optional(),
  materials: z.string().max(30000).optional(), replace_scope: z.boolean().optional(),
  answer_to: z.uuid().optional(), option_id: z.enum(["approve", "edit"]).optional(),
}).refine(value => !value.option_id || value.input === "typed" && !!value.answer_to, "Choose an option on the current proposal");
export type TStudioTurnInput = z.infer<typeof studio_turn_input>;
export const studio_scope_input = z.strictObject({
  source_ids: z.array(z.uuid()).max(source_selection_limit), source_policy: source_policy_schema,
  urls: z.array(z.string().max(2048)).max(url_selection_limit), materials: z.string().max(30000),
  expected_proposal_id: z.uuid().nullable(),
});
export type TStudioScopeInput = z.infer<typeof studio_scope_input>;

const phase_schema = z.enum(["interview", "proposed", "researching", "done"]);
export type TStudioPhase = z.infer<typeof phase_schema>;

export const pitch_intent = z.strictObject({
  subject: z.string().trim().min(1).max(200), audience: z.string().trim().min(1).max(200),
  outcome: z.string().trim().min(1).max(300), deliverable: z.string().trim().min(1).max(200),
});
export type TPitchIntent = z.infer<typeof pitch_intent>;

export type TResearchProposal = { proposal_id: string; summary: string; queries: string[]; urls: string[]; source_policy: TSourcePolicy;
  intent?: TPitchIntent };
export type TStudioState = {
  phase: TStudioPhase;
  goal: string | null;
  notes: string[];
  reply_language: string | null;
  proposal: TResearchProposal | null;
  proposal_heard: boolean;
  proposal_turn_id?: string;
  source_ids: string[];
  materials: string;
  urls?: string[];
  source_policy?: TSourcePolicy;
  factual_notes?: string[];
  last_language?: string;
};

const proposal_schema = z.object({
  proposal_id: z.uuid(), summary: z.string(), queries: z.array(z.string()), urls: z.array(z.string()), source_policy: source_policy_schema,
  intent: pitch_intent.optional(),
});
const state_schema = z.object({
  phase: phase_schema, goal: z.string().nullable(), notes: z.array(z.string()), reply_language: studio_language.nullable(),
  proposal: proposal_schema.nullable(), proposal_heard: z.boolean(), proposal_turn_id: z.uuid().optional(),
  source_ids: z.array(z.uuid()), materials: z.string(), urls: z.array(z.string()).optional(),
  source_policy: source_policy_schema.optional(), factual_notes: z.array(z.string()).optional(), last_language: studio_language.optional(),
});
const legacy_state_schema = z.object({
  entities: z.object({ subject: z.string().nullish(), audience: z.string().nullish(), decision: z.string().nullish(),
    urls: z.array(z.string()).optional(), facts: z.array(z.string()).optional() }).optional(),
  language_preference: studio_language.nullish(), source_ids: z.array(z.uuid()).optional(),
  materials: z.string().optional(), source_policy: source_policy_schema.optional(),
});

export const parse_state = (stored: unknown, has_job: boolean): TStudioState => {
  const current = state_schema.safeParse(stored);
  if (current.success) return current.data;
  const legacy = legacy_state_schema.safeParse(stored);
  const value = legacy.success ? legacy.data : undefined;
  const entities = value?.entities;
  return {
    phase: has_job ? "done" : "interview", goal: null,
    notes: [entities?.subject, entities?.audience, entities?.decision, ...(entities?.urls ?? []), ...(entities?.facts ?? [])]
      .filter((note): note is string => !!note?.trim()).slice(-12),
    reply_language: value?.language_preference ?? null, proposal: null, proposal_heard: false,
    source_ids: value?.source_ids ?? [], materials: value?.materials ?? "",
    urls: entities?.urls ?? [], source_policy: value?.source_policy ?? "public_search",
  };
};

export const action_inputs = {
  remember: z.strictObject({ goal: z.string().min(1).max(300).nullable(), notes: z.array(z.string().min(1).max(600)).max(12) }),
  propose_research: z.strictObject({
    summary: z.string().min(1).max(400), queries: z.array(z.string().min(1).max(300)).max(3),
    urls: z.array(z.string().max(2048)).max(url_selection_limit), intent: pitch_intent.optional(),
  }),
  start_research: z.strictObject({}),
  set_reply_language: z.strictObject({ language: studio_language }),
};
const agent_action_schema = z.discriminatedUnion("kind", [
  action_inputs.remember.extend({ kind: z.literal("remember"), goal: action_inputs.remember.shape.goal.optional() }),
  action_inputs.propose_research.extend({ kind: z.literal("propose_research") }),
  action_inputs.start_research.extend({ kind: z.literal("start_research") }),
  action_inputs.set_reply_language.extend({ kind: z.literal("set_reply_language") }),
]);
export type TAgentAction = z.infer<typeof agent_action_schema>;
export const file_citation_schema = z.strictObject({ evidence_id: z.string(), excerpt: z.string().max(300) });
export const agent_turn_schema = z.strictObject({
  reply: z.string().trim().min(1).max(400), language: studio_language, actions: z.array(agent_action_schema).max(8),
  citations: z.array(file_citation_schema).max(3).optional(), file_question: z.boolean().optional(),
});
export type TAgentTurn = z.infer<typeof agent_turn_schema>;

export const allowed_actions: Record<TStudioPhase, TAgentAction["kind"][]> = {
  interview: ["remember", "propose_research", "set_reply_language"],
  proposed: ["remember", "propose_research", "start_research", "set_reply_language"],
  researching: ["set_reply_language"],
  done: ["remember", "propose_research", "set_reply_language"],
};

// Older saved turns and activities retain these fields on read.
export type TStudioIntent = "greeting" | "meta" | "language" | "brief" | "clarify" | "correction" | "file_question" |
  "status" | "scope" | "revision" | "approval" | "url_confirmation" | "unsupported";
export type TStudioAsk = {
  request_id: string; turn_id: string; kind: string; question: string;
  options: { id: string; label: string }[]; allow_free_text: true; brief_id: string | null;
};
export type TStudioActivity = {
  tool: "read_source" | "queue_research" | "ask_input";
  status: "completed" | "queued" | "awaiting_input";
  result: string;
  question?: TStudioAsk;
  citations?: { evidence_id: string; location: string; excerpt: string }[];
};
export type TStudioTurn = {
  turn_id: string; created_at: number; user_text: string; text: string; language: string;
  voice_items?: string[];
  voice_reply?: string;
  phase: TStudioPhase; proposal: TResearchProposal | null;
  activity?: TStudioActivity; answer_to?: string; option_id?: string; intent?: TStudioIntent;
};
