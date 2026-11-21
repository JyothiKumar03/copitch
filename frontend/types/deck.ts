import type { TResearchSession } from "./research";
import type { TPresentationReadiness } from "../../shared/presentation";

export type TConversionChart = {
  period: string | null;
  rows: { label: string; numerator: number; denominator: number; evidence_id: string }[];
};

export type TSlideTemplate =
  | { type: "title_card" | "bullet_slide" }
  | { type: "metric_grid"; metrics: { label: string; value: string }[] }
  | { type: "timeline"; entries: { date: string; label: string }[] }
  | { type: "quote"; quote: string; attribution: string | null }
  | { type: "comparison"; columns: { label: string; points: string[] }[] }
  | { type: "bar_chart" | "line_chart" | "donut_chart"; unit: string; points: { label: string; value: number }[] };

export type TSlide = {
  chart?: TConversionChart;
  chart_period?: string;
  template?: TSlideTemplate;
  beat_id?: string;
  sentences?: { sentence_id: string; text: string; evidence_ids: string[] }[];
  estimated_seconds?: number;
  slide_id: string;
  layout: "headline" | "evidence" | "takeaway";
  title: string;
  highlights: string[];
  narration: string;
  evidence_ids: string[];
};
export type TPublicSlide = Pick<TSlide, "slide_id" | "layout" | "title" | "highlights" | "evidence_ids" | "chart" | "chart_period" | "template">;
// sources: readable source names for the slide footer (site names or file names), never internal evidence IDs.
export type TSlideView = { deckTitle: string; index: number; total: number; slide: TPublicSlide; sources?: string[] };
export type TPitchInput = {
  audience: string;
  duration_minutes: number;
  slide_count?: number;
  demo?: { url: string; objective: string; seconds: number; after_slide_id?: string };
};
export type TPitchPlan = TPitchInput & { estimated_seconds: number; rationale: string; readiness?: TPresentationReadiness };
export type TPitchRequest = Required<Pick<TPitchInput, "slide_count">>;
export type TSavedPitch = { deck_id: string; label: string };
export type TSlideCountPromptProps = { initialCount?: number; pending: boolean; onPrepare: (pitch: TPitchRequest) => void };
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
  attribution?: { evidence_id: string; excerpt: string }[];
};
export type TSlideChanges = Partial<Pick<TSlide, "title" | "highlights" | "narration" | "layout">>;
export type TEditInput = {
  command_id: string;
  base_revision: number;
  slide_id: string;
  changes: TSlideChanges;
};
export type TDeckWorkspaceProps = { researchId: string; getSession: () => Promise<TResearchSession> };

export type TLiveReply =
  | { kind: "answer"; text: string; evidence_ids: string[]; citations?: { evidence_id: string; excerpt: string }[] }
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
