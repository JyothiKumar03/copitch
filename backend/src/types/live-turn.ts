import type { TEditProposal, TSlide, TSlideChanges } from "./deck";

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
};

export type TLiveDecision =
  | { kind: "answer"; text: string; support: { evidence_id: string; excerpt: string }[] }
  | { kind: "clarify"; text: string }
  | { kind: "edit"; text: string; changes: TSlideChanges };

export type TLiveReply =
  | { kind: "answer"; text: string; evidence_ids: string[] }
  | { kind: "clarify"; text: string }
  | { kind: "edit"; text: string; proposal: TEditProposal };

export type TLiveModel = (context: TLiveTurnContext, signal: AbortSignal) => Promise<TLiveDecision>;
