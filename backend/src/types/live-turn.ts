import type { TEditProposal, TSlide, TSlideChanges } from "./deck";
import type { TAttempt } from "./ai";

export type TLiveTurnInput = {
  turn_id: string;
  base_revision: number;
  slide_id: string;
  message: string;
};

export type TLiveTurnContext = {
  title: string;
  slide: TSlide;
  message: string;
  evidence: { id: string; source: string; passage: string }[];
  recent_turns: { message: string; response: string }[];
  presentation?: { sentence_index: number; pending_review: boolean; slide_choices: { slide_id: string; title: string }[] };
};

export type TLiveCitation = { evidence_id: string; excerpt: string };
export type TLiveNavigation = "pause" | "resume" | "back" | "next" | "skip" | "go_to" | "approve" | "reject";

export type TLiveDecision =
  | { kind: "answer"; text: string; support: TLiveCitation[] }
  | { kind: "clarify"; text: string }
  | { kind: "edit"; text: string; changes: TSlideChanges; support?: TLiveCitation[] }
  | { kind: "ignore"; text: string }
  | { kind: "control"; text: string; command: TLiveNavigation; slide_id?: string };

export type TLiveReply =
  | { kind: "answer"; text: string; evidence_ids: string[]; citations?: TLiveCitation[] }
  | { kind: "clarify"; text: string }
  | { kind: "edit"; text: string; proposal: TEditProposal };

export type TLiveModel = (context: TLiveTurnContext, signal: AbortSignal, on_attempt?: (attempt: TAttempt) => void) => Promise<TLiveDecision>;
