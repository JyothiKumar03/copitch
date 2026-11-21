import type { TPitchChartSelection } from "./pitch-artifact";
import type { TConversionMetric, TCsvObservation, TSourceSummary } from "./source";
import type { TPitchPassage } from "./pitch-content";
import type { TStudioIntent } from "./studio-turn";

export type TSourcePolicy = "files_only" | "public_search";

export type TBriefReview = {
  summary: string;
  question: string | null;
  public_queries: string[];
};

export type TInterviewTurn = { role: "host" | "assistant"; text: string; turn_id?: string; created_at?: number; intent?: TStudioIntent;
  answer_to?: string; option_id?: string };

export type TResearchBrief = TBriefReview & {
  history?: TInterviewTurn[];
  sources?: TSourceSummary[];
  brief_id: string;
  source_policy: TSourcePolicy;
  messages: string[];
  materials: string;
  urls: string[];
};

export type TEvidence = {
  derived_from?: string[];
  id: string;
  source_id?: string;
  metric?: TConversionMetric;
  numeric_series?: TCsvObservation[];
  origin: "host" | "material" | "public";
  location: string;
  passage: string;
  url?: string;
};

export type TResearchDraft = {
  pitch_chart?: TPitchChartSelection | null;
  pitch_script?: TPitchPassage[];
  title: string;
  sections: { heading: string; paragraphs: { prose: string; support: { evidence_id: string; excerpt: string }[] }[] }[];
  gaps: string[];
};

export type TGrounding = { version: 1; mode: "verified" | "source_extracts"; chart?: "verified" | "withheld" };
export type TGroundingUnit = {
  id: string; kind: "title" | "heading" | "paragraph"; text: string;
  support: { evidence_id: string; excerpt: string }[];
};
export type TGroundingReview = { units: TGroundingUnit[]; evidence: TEvidence[]; gaps: string[] };
export type TGroundingVerdict = { id: string; decision: "supported" | "unsupported" | "missing_qualification" };
export type TResearchBundle = {
  pitch_markdown?: string;
  pitch_chart?: TPitchChartSelection | null;
  pitch_script?: TPitchPassage[];
  grounding?: TGrounding;
  research_id: string;
  brief_id: string;
  markdown: string;
  confirmed_brief: TResearchBrief;
  findings: Pick<TResearchDraft, "title" | "sections">;
  evidence: TEvidence[];
  gaps: string[];
};

export type TSearchHit = { passage: string; url: string; title: string };
export type TResearchProvider = {
  clarify: (scope: { messages: string[]; history?: TInterviewTurn[]; urls: string[]; source_policy: TSourcePolicy; previous_question?: string | null }, signal: AbortSignal) => Promise<TBriefReview>;
  lookup: (query: string, url: string | undefined, signal: AbortSignal, observed?: (action: "search" | "open" | "find" | "failed") => void) => Promise<TSearchHit[]>;
  verify?: (review: TGroundingReview, signal: AbortSignal) => Promise<TGroundingVerdict[]>;
  draft: (brief: string, evidence: TEvidence[], gaps: string[], signal: AbortSignal) => Promise<TResearchDraft>;
};
