import type { TLiveReply, TProposal } from "./deck";

export type TPresentationState = {
  revision: number;
  generation: number;
  version: number;
  status: "paused" | "awaiting_paint" | "narrating" | "listening" | "answering" | "awaiting_decision" | "completed";
  cursor: { slide_id: string; sentence_index: number };
  attempt: { attempt_id: string; kind: "narration" | "answer" | "accepted_edit"; text: string } | null;
  pin: { pin_id: string; slide_id: string; sentence_index: number; revision: number } | null;
  proposal: TProposal | null;
  last_reply: TLiveReply | null;
  stage_sequence: number;
  painted: boolean;
};

export type TPresentationAction =
  | { kind: "pause" | "resume" | "next" | "back" | "skip" | "reconnect" | "restart" }
  | { kind: "interrupt"; attempt_id?: string }
  | { kind: "playing" | "ended" | "failed"; attempt_id: string }
  | { kind: "decide"; proposal_id: string; slide_id: string; decision: "approve" | "reject" };

export type TPresentationOpen = { state: TPresentationState; stage: { sequence: number; token: string; expires_at: number } };
export type TStagePaint = { sequence: number; revision: number; slide_id: string };
