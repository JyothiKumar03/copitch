import { z } from "zod";
import type { TContinuationState } from "./continuation";
import type { TEditProposal } from "./deck";
import type { TLiveReply } from "./live-turn";

const id = z.string().min(1).max(192);
const kind = <T extends string>(value: T) => z.literal(value);
const playback_action = <T extends string>(value: T) => z.strictObject({ kind: kind(value), attempt_id: id });

export const presentation_action = z.discriminatedUnion("kind", [
  z.strictObject({ kind: kind("pause") }), z.strictObject({ kind: kind("resume") }),
  z.strictObject({ kind: kind("next") }), z.strictObject({ kind: kind("back") }),
  z.strictObject({ kind: kind("skip") }), z.strictObject({ kind: kind("restart") }),
  z.strictObject({ kind: kind("reconnect") }),
  z.strictObject({ kind: kind("go_to"), slide_id: id }),
  z.strictObject({ kind: kind("interrupt"), attempt_id: id.optional() }),
  playback_action("playing"), playback_action("ended"), playback_action("failed"),
  z.strictObject({ kind: kind("decide"), proposal_id: id, slide_id: id, decision: z.enum(["approve", "reject"]) }),
]);
export const presentation_command = z.strictObject({
  event_id: id, revision: z.number().int().positive(), generation: z.number().int().nonnegative(), action: presentation_action,
});
export const presentation_start = z.strictObject({ revision: z.number().int().positive(), approved: z.literal(true) });
export const presentation_microphone_offer = z.strictObject({
  revision: z.number().int().positive(),
  sdp: z.string().max(65_536).refine(offer => /^v=0\r?\n/u.test(offer) && /^m=audio /mu.test(offer)),
});
export const presentation_paint = z.strictObject({ sequence: z.number().int().positive(), revision: z.number().int().positive(), slide_id: id });
export const presentation_turn = z.strictObject({ turn_id: id, pin_id: id, message: z.string().trim().min(1).max(2000) });

export type TPresentationAction = z.infer<typeof presentation_action>;
export type TPresentationCommand = z.infer<typeof presentation_command>;
export type TPresentationPaint = z.infer<typeof presentation_paint>;
export type TPresentationTurn = z.infer<typeof presentation_turn>;
export type TPresentationStatus = "paused" | "awaiting_paint" | "narrating" | "listening" | "answering" | "awaiting_decision" | "completed";
export type TPresentationAttempt = { attempt_id: string; kind: "narration" | "answer" | "accepted_edit"; text: string };
export type TPresentationCursor = { slide_id: string; sentence_index: number };
export type TPresentationPin = TPresentationCursor & { pin_id: string; revision: number };
export type TPresentationProposal = TEditProposal & { attribution?: { evidence_id: string; excerpt: string }[] };
export type TPresentationState = {
  revision: number; generation: number; version: number; status: TPresentationStatus; cursor: TPresentationCursor;
  attempt: TPresentationAttempt | null; pin: TPresentationPin | null; proposal: TPresentationProposal | null;
  last_reply: TLiveReply | null; stage_sequence: number; painted: boolean;
};
export type TPresentationStored = TPresentationState & {
  continuation: TContinuationState;
  stage_painted_at?: number;
  active_playback: boolean;
  wants_playback: boolean;
  pending_turn: string | null;
  pending_advance: { revision: number; stage_sequence: number; sentences: string[]; next: number } | null;
};
