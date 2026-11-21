import { z } from "zod";
import { LANGUAGE_OPTIONS } from "../../../shared/languages";
import type { TInterviewLanguage } from "../../../shared/languages";
import type { TSourcePolicy } from "./research";

export const turn_text_limit = 6000;
export const spoken_text_limit = 1600;
export const source_selection_limit = 6;
export const url_selection_limit = 8;
export const studio_intents = ["greeting", "meta", "language", "brief", "clarify", "correction", "file_question",
  "status", "scope", "revision", "approval", "url_confirmation", "unsupported"] as const;
export type TStudioIntent = typeof studio_intents[number];
export const studio_language = z.enum(Object.keys(LANGUAGE_OPTIONS) as TInterviewLanguage[]);

export const studio_turn_input = z.strictObject({
  turn_id: z.uuid(), message: z.string().trim().min(1).max(turn_text_limit), input: z.enum(["typed", "speech"]),
  brief_id: z.uuid().optional(), source_policy: z.enum(["files_only", "public_search"]).optional(),
  source_ids: z.array(z.uuid()).max(source_selection_limit).optional(),
  urls: z.array(z.string().max(2048)).max(url_selection_limit).optional(),
  materials: z.string().max(30000).optional(), replace_scope: z.boolean().optional(),
  answer_to: z.uuid().optional(), option_id: z.string().min(1).max(60).optional(),
  heard_question_id: z.uuid().optional(), heard_turn_id: z.uuid().optional(),
}).refine(value => !value.option_id || !!value.answer_to, "An option requires its question ID")
  .refine(value => Boolean(value.heard_question_id) === Boolean(value.heard_turn_id), "Playback requires question and turn IDs");
export type TStudioTurnInput = z.infer<typeof studio_turn_input>;

export type TStudioAskKind = "subject" | "audience" | "decision" | "source_url" | "reference" | "approval";
export type TStudioAsk = {
  request_id: string;
  turn_id: string;
  kind: TStudioAskKind;
  question: string;
  options: { id: string; label: string }[];
  allow_free_text: true;
  brief_id: string | null;
};

export type TStudioContext = {
  language_preference: TInterviewLanguage | null;
  entities: { subject: string | null; audience: string | null; decision: string | null; urls: string[]; facts: string[] };
  pending: { url: string; phrase: string } | null;
  source_policy: TSourcePolicy;
  source_ids: string[];
  materials: string;
  reviewable_brief_id: string | null;
  ask?: TStudioAsk | null;
  reference?: string;
  instructions?: string[];
};

export type TStudioActivity = {
  tool: "read_source" | "queue_research" | "ask_input";
  status: "completed" | "queued" | "awaiting_input";
  result: string;
  question?: TStudioAsk;
  citations?: { evidence_id: string; location: string; excerpt: string }[];
};

export type TStudioTurn = {
  turn_id: string;
  created_at: number;
  user_text: string;
  text: string;
  intent: TStudioIntent;
  language: TInterviewLanguage;
  activity?: TStudioActivity;
  answer_to?: string;
  option_id?: string;
};
