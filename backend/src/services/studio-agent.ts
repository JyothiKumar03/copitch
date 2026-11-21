import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { configured_models_for } from "./model-config";
import { action_inputs, agent_turn_schema, allowed_actions, file_citation_schema, pitch_intent, studio_language } from "../types/studio-turn";
import { typed_interviewer } from "./prompts";
import type { TAgentTurn, TStudioState } from "../types/studio-turn";
import type { TEvidence, TInterviewTurn } from "../types/research";

export type TStudioAgentInput = {
  message: string;
  history: TInterviewTurn[];
  state: TStudioState;
  files: { filename: string }[];
  job_status: string | null;
  evidence?: TEvidence[];
};

export type TStudioAgent = (input: TStudioAgentInput, signal: AbortSignal) => Promise<TAgentTurn>;

export const agent_instructions = (state: TStudioState) =>
  typed_interviewer + `\n\n# Session\nCurrent phase: ${state.phase}. Allowed actions: ${allowed_actions[state.phase].join(", ")}.`;

const plan_draft = action_inputs.propose_research.omit({ intent: true }).extend(pitch_intent.shape);
const agent_reply = z.strictObject({
  factual_notes: action_inputs.remember.shape.notes,
  suggested_goal: action_inputs.remember.shape.goal, language_preference: studio_language.nullable(),
  intent: z.enum(["plan", "conversation", "file_question", "approve"]),
  plan: plan_draft.nullable(), citations: z.array(file_citation_schema).max(3),
  language: studio_language, reply: z.string().min(1).max(400),
});

export const create_studio_agent = (model: LanguageModel, max_output_tokens = 900): TStudioAgent => async (input, signal) => {
  const allowed = allowed_actions[input.state.phase];
  const { reply, language, intent, plan, citations, factual_notes, suggested_goal, language_preference } = (await generateText({
    model, maxOutputTokens: max_output_tokens, maxRetries: 1, abortSignal: signal,
    providerOptions: { openai: { store: false } },
    instructions: agent_instructions(input.state), prompt: JSON.stringify(input), output: Output.object({ schema: agent_reply }),
  })).output;
  const planned = intent === "plan" && plan;
  const goal = planned ? plan.subject : suggested_goal;
  const actions: TAgentTurn["actions"] = [];
  if (goal || factual_notes.length) actions.push({ kind: "remember", goal, notes: factual_notes });
  if (language_preference) actions.push({ kind: "set_reply_language", language: language_preference });
  if (planned) actions.push({ kind: "propose_research", summary: plan.summary, queries: plan.queries, urls: plan.urls,
    intent: { subject: plan.subject, audience: plan.audience, outcome: plan.outcome, deliverable: plan.deliverable } });
  if (intent === "approve") actions.push({ kind: "start_research" });
  return agent_turn_schema.parse({ reply, language, actions: actions.filter(action => allowed.includes(action.kind)),
    ...(intent === "file_question" && { file_question: true, citations }),
  });
};

export const studio_agent: TStudioAgent = async (input, signal) => {
  const [model] = configured_models_for("interview");
  if (!model || !process.env.OPENAI_API_KEY) throw new Error("Studio interview model is unavailable");
  return create_studio_agent(createOpenAI().responses(model.model), Math.min(900, model.max_output_tokens))(input, signal);
};
