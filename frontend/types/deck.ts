import type { TResearchSession } from "./research";

export type TConversionChart = {
  period: string | null;
  rows: { label: string; numerator: number; denominator: number; evidence_id: string }[];
};

export type TSlide = {
  chart?: TConversionChart;
  slide_id: string;
  layout: "headline" | "evidence" | "takeaway";
  title: string;
  highlights: string[];
  narration: string;
  evidence_ids: string[];
};
export type TPitchInput = {
  audience: string;
  duration_minutes: number;
  slide_count?: number;
  demo?: { url: string; objective: string; seconds: number; after_slide_id?: string };
};
export type TPitchPlan = TPitchInput & { estimated_seconds: number; rationale: string };
export type TSavedPitch = { deck_id: string; label: string };
export type TPitchFormProps = { initial?: TPitchInput; pending: boolean; onPrepare: (pitch: TPitchInput) => void };
export type TDeck = {
  deck_id: string;
  research_id: string;
  revision: number;
  title: string;
  slides: TSlide[];
  pitch?: TPitchPlan;
  grounding_mode?: "verified" | "source_extracts";
  sources?: { id: string; origin: string; location: string; url?: string }[];
};
export type TProposal = {
  proposal_id: string;
  deck_id: string;
  base_revision: number;
  slide_id: string;
  before: TSlide;
  after: TSlide;
  status: "pending" | "approved" | "rejected";
  approved_revision: number | null;
};
export type TSlideChanges = Partial<Pick<TSlide, "title" | "highlights" | "narration" | "layout">>;
export type TEditInput = {
  command_id: string;
  base_revision: number;
  slide_id: string;
  changes: TSlideChanges;
};
export type TDeckWorkspaceProps = { researchId: string; getSession: () => Promise<TResearchSession> };

export type TContinuation = {
  revision: number;
  generation: number;
  points: { point_id: string; skipped: boolean; spoken: string; demo: string }[];
  next: { kind: "done" } | { kind: "speak" | "demo" | "retry_or_skip"; point_id: string };
};
export type TLiveTurnInput = {
  turn_id: string;
  base_revision: number;
  slide_id: string;
  message: string;
};
export type TLiveReply =
  | { kind: "answer"; text: string; evidence_ids: string[] }
  | { kind: "clarify"; text: string }
  | { kind: "edit"; text: string; proposal: TProposal };
export type TSlideOrderProps = {
  deck: TDeck;
  ids: string[];
  pending: boolean;
  onChange: (ids: string[]) => void;
  onCancel: () => void;
  onSave: () => void;
  onReload?: () => void;
};
