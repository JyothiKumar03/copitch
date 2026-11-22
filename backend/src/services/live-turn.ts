import { createOpenAI } from "@ai-sdk/openai";
import { APICallError, generateText, Output } from "ai";
import type { LanguageModelUsage } from "ai";
import { AppError } from "../errors/app-error";
import { z } from "zod";
import type { TDeck, TSlide } from "../types/deck";
import type { TLiveDecision, TLiveModel, TLiveTurnContext, TLiveTurnInput } from "../types/live-turn";
import type { TResearchBundle } from "../types/research";
import { configured_models_for } from "./model-config";
import { quotes } from "./excerpt";
import { make_attempt } from "./ai-sdk";
import { slide_template_schema } from "./deck";
import { live_slide_turn } from "./prompts";

// Use one strict root object with nullable edit fields for OpenAI structured outputs.
const model_output = z.object({
  kind: z.enum(["answer","clarify","edit"]), text: z.string(),
  support: z.array(z.object({ evidence_id: z.string(), excerpt: z.string() })),
  changes: z.object({
    title: z.string().nullable(), highlights: z.array(z.string()).nullable(), narration: z.string().nullable(),
    layout: z.enum(["headline","evidence","takeaway"]).nullable(),
  }).nullable(),
});
const presentation_model_output = z.object({
  ...model_output.shape,
  kind: z.enum(["answer", "clarify", "edit", "control", "ignore"]),
  changes: model_output.shape.changes.unwrap().extend({
    template: slide_template_schema.nullable(),
    append_highlights: z.array(z.string()).nullable(),
    append_narration: z.string().nullable(),
  }).nullable(),
  command: z.enum(["pause", "resume", "back", "next", "skip", "go_to", "approve", "reject"]).nullable(),
  target_slide_id: z.string().nullable(),
});


export const live_input = z.strictObject({
  turn_id: z.string().trim().min(1).max(120), base_revision: z.number().int().positive(),
  slide_id: z.string().trim().min(1).max(128), message: z.string().trim().min(1).max(2000),
});

export const live_context = (
  deck: TDeck, slide: TSlide, request: TLiveTurnInput, research: TResearchBundle, recent_turns: TLiveTurnContext["recent_turns"],
): TLiveTurnContext => {
  const words = [...new Set(request.message.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].slice(0,24);
  const current_ids = new Set(slide.evidence_ids);
  const ranked = research.evidence.map(item => {
    const searchable = (item.location + " " + item.passage).toLocaleLowerCase();
    const matches = words.filter(word => searchable.includes(word));
    return { item, matches, score: matches.length * 2 + (current_ids.has(item.id) ? 3 : 0) };
  }).filter(candidate => candidate.score).sort((a,b) => b.score - a.score).slice(0,6);
  const evidence = ranked.map(({item, matches}) => {
    const start = Math.max(0, item.passage.toLocaleLowerCase().indexOf(matches[0] ?? "") - 250);
    return { id: item.id, source: item.location.slice(0,180), passage: item.passage.slice(start,start+1200) };
  });
  return { title: deck.title, message: request.message, slide: { ...slide, narration: slide.narration.slice(0,2200) },
    evidence, recent_turns };
};

export const classify_live_turn: TLiveModel = async (context, signal, on_attempt) => {
  const models = configured_models_for("live");
  if (!models.length || !process.env.OPENAI_API_KEY) throw new AppError(503, "Configure an OpenAI live text model");
  const openai = createOpenAI();
  for (const [index,candidate] of models.entries()) {
    let usage: LanguageModelUsage | undefined;
    try {
      const settings = {
        model: openai.responses(candidate.model), temperature: candidate.temperature,
        maxOutputTokens: candidate.max_output_tokens, abortSignal: signal, maxRetries: 0,
        providerOptions: { openai: { store:false } },
        prompt: JSON.stringify(context),
      };
      const response = context.presentation
        ? await generateText({ ...settings, output: Output.object({ schema: presentation_model_output }), instructions: live_slide_turn(true) })
        : await generateText({ ...settings, output: Output.object({ schema: model_output }), instructions: live_slide_turn(false) });
      usage = response.usage;
      const result = response.output;
      const { kind,text,support,changes } = result;
      if (kind === "edit" && !changes || kind === "control" && (!("command" in result) || !result.command)) {
        throw new AppError(502, "Model returned an incomplete presentation action");
      }
      on_attempt?.(make_attempt(candidate, "completed", usage));
      if (kind === "edit" && changes) {
        const { append_highlights, append_narration, ...fields } = "append_highlights" in changes && "append_narration" in changes
          ? changes : { ...changes, append_highlights: null, append_narration: null };
        const additions = {
          ...(append_highlights && { highlights: append_highlights }),
          ...(append_narration && { narration: append_narration }),
        };
        return { kind, text, support, additions, changes: Object.fromEntries(Object.entries(fields).filter(([,v]) => v !== null)) };
      }
      if (kind === "answer") return { kind,text,support };
      if (kind === "clarify") return { kind,text };
      if (kind === "ignore") return { kind, text };
      if (kind === "control" && "command" in result && result.command) return { kind, text, command: result.command, ...(result.target_slide_id && { slide_id: result.target_slide_id }) };
      throw new AppError(502, "Model returned an incomplete edit");
    } catch (error) {
      on_attempt?.(make_attempt(candidate, "failed", usage));
      if (signal.aborted || !APICallError.isInstance(error) || !error.isRetryable || index === models.length - 1) throw error;
    }
  }
  throw new AppError(503, "Live model unavailable");
};

const question_start = /^\s*(?:what|why|how|when|where|who|whom|whose|which|is|are|am|was|were|can|could|do|does|did|will|would|should|shall|may|might|have|has|had|tell me|explain)\b/iu;
const is_question = (message: string) => message.trim().endsWith("?") || question_start.test(message);

export const check_live_answer = (decision: TLiveDecision, context: TLiveTurnContext) => {
  if (decision.kind === "ignore") return decision;
  if (context.presentation && decision.kind === "edit" && !decision.text.trim()) {
    return { ...decision, text: "Review this proposed change." };
  }
  if (!decision.text.trim() || decision.text.length > 6000) throw new AppError(502, "Invalid model reply");
  if (decision.kind !== "answer") return decision;
  // A presenter's own statement is host evidence (the prompt asks for evidence_id "host"). It may only acknowledge
  // a statement, never support an answer to a question, so a question cannot vouch for itself.
  const host_statement = !!context.presentation && !is_question(context.message);
  const valid = decision.support.length && decision.support.every(ref => ref.excerpt.trim() &&
    (host_statement && ref.evidence_id === "host" && quotes(context.message, ref.excerpt) ||
      context.evidence.some(item => item.id === ref.evidence_id && quotes(item.passage, ref.excerpt))));
  if (!valid) return { kind: "clarify" as const, text: "The available sources do not support that answer. Which source or detail should I use?" };
  return { kind: "answer" as const, text: decision.text, evidence_ids: [...new Set(decision.support.map(ref => ref.evidence_id))],
    ...(context.presentation && { citations: decision.support }) };
};
