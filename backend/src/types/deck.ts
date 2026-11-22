import type { TPresentationReadiness } from "../../../shared/presentation";

export { MAX_PRESENTATION_SLIDES } from "../../../shared/presentation";
export type { TPresentationReadiness } from "../../../shared/presentation";

export type TSlideLayout = "headline" | "evidence" | "takeaway";

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

export type TDeckSentence = { sentence_id: string; text: string; evidence_ids: string[] };

export type TSlide = {
  chart?: TConversionChart;
  chart_period?: string;
  slide_id: string;
  layout: TSlideLayout;
  title: string;
  highlights: string[];
  narration: string;
  evidence_ids: string[];
  template?: TSlideTemplate;
  beat_id?: string;
  sentences?: TDeckSentence[];
  estimated_seconds?: number;
};

export type TPitchInput = {
  audience: string;
  duration_minutes: number;
  slide_count?: number;
  demo?: { url: string; objective: string; seconds: number; after_slide_id?: string };
};
export type TDeckPlanInput = TPitchInput | { slide_count: number };
export type TPitchMetadata = TPitchInput & {
  estimated_seconds: number;
  rationale: string;
  readiness?: TPresentationReadiness;
};

export type TDeck = {
  pitch?: TPitchMetadata;
  deck_id: string;
  research_id: string;
  revision: number;
  title: string;
  slides: TSlide[];
  sources?: { id: string; origin: "host" | "material" | "public"; location: string; url?: string; image?: string }[];
  grounding_mode?: "verified" | "source_extracts";
  render_review?: { rounds: number; status: "passed" };
};

export type TDeckLayoutIssue = {
  slide_id: string;
  issue: "overflow" | "collision" | "unreadable_text" | "visual_hierarchy" | "chart_legibility";
  viewport?: string;
  note?: string;
};
export type TDeckLayoutRepair = { deck: TDeck; issues: TDeckLayoutIssue[] };

export type TSlideChanges = Partial<Pick<TSlide, "layout" | "title" | "highlights" | "narration" | "template">>;

export type TEditRequest = {
  command_id: string;
  base_revision: number;
  slide_id: string;
  changes: TSlideChanges;
};

export type TEditProposal = {
  proposal_id: string;
  deck_id: string;
  base_revision: number;
  slide_id: string;
  before: TSlide;
  after: TSlide;
  status: "pending" | "approved" | "rejected";
  approved_revision: number | null;
  attribution?: { evidence_id: string; excerpt: string }[];
  sources_added?: TDeck["sources"];
};
