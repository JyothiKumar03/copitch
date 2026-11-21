export type TSlideLayout = "headline" | "evidence" | "takeaway";

export type TConversionChart = {
  period: string | null;
  rows: { label: string; numerator: number; denominator: number; evidence_id: string }[];
};

export type TSlide = {
  chart?: TConversionChart;
  slide_id: string;
  layout: TSlideLayout;
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
export type TPitchMetadata = TPitchInput & { estimated_seconds: number; rationale: string };

export type TDeck = {
  pitch?: TPitchMetadata;
  deck_id: string;
  research_id: string;
  revision: number;
  title: string;
  slides: TSlide[];
  sources?: { id: string; origin: "host" | "material" | "public"; location: string; url?: string }[];
  grounding_mode?: "verified" | "source_extracts";
};

export type TSlideChanges = Partial<Pick<TSlide, "layout" | "title" | "highlights" | "narration">>;

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
};
