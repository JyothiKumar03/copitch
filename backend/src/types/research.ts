import type { TPitchChartSelection } from "./pitch-artifact";
import type { TConversionMetric, TCsvObservation, TSourceSummary } from "./source";
import type { TPitchPassage } from "./pitch-content";
import type { TStudioIntent } from "./studio-turn";
import type { TAttempt, TModelStep } from "./ai";
import type { TResearchGraph } from "../../../shared/research-graphs";

export type TSourcePolicy = "files_only" | "public_search";

export type TBriefReview = {
  summary: string;
  question: string | null;
  public_queries: string[];
};

export type TInterviewTurn = { role: "host" | "assistant"; text: string; turn_id?: string; created_at?: number; intent?: TStudioIntent;
  answer_to?: string; option_id?: string; voice_items?: string[]; language?: string };

export type TResearchBrief = TBriefReview & {
  studio_version?: 2;
  studio_notes?: string[];
  intent?: { subject: string; audience: string; outcome: string; deliverable: string };
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
  // Host-only API path of a captured page screenshot that this passage was read from.
  image?: string;
};

export type TResearchDraft = {
  graph_xml?: string;
  pitch_chart?: TPitchChartSelection | null;
  pitch_script?: TPitchPassage[];
  title: string;
  sections: { heading: string; paragraphs: { prose: string; support: { evidence_id: string; excerpt: string }[] }[] }[];
  gaps: string[];
};

export type TGrounding = { version: 1; mode: "verified" | "source_extracts"; chart?: "verified" | "withheld" };
export type TGroundingUnit = {
  id: string; kind: "title" | "heading" | "paragraph" | "gap"; text: string;
  support: { evidence_id: string; excerpt: string }[];
};
export type TGroundingCoverageBrief = Pick<TResearchBrief, "summary" | "intent" | "messages">;
export type TGroundingCoverage = {
  brief: TGroundingCoverageBrief;
  evidence: Pick<TEvidence, "id" | "origin" | "location" | "passage" | "url">[];
  previous_findings?: string;
};
export type TGroundingReview = { units: TGroundingUnit[]; evidence: TEvidence[]; gaps: string[]; coverage?: TGroundingCoverage;
  purpose?: "live_presentation" | "deck_presentation" };
export type TGroundingVerdict = { id: string; decision: "supported" | "unsupported" | "missing_qualification"; reason?: string };
export type TGroundingOmission = { finding: string; reason: string; evidence_ids: string[]; objective_excerpt?: string };
export type TGroundingReviewResult = TGroundingVerdict[] | { verdicts: TGroundingVerdict[]; omissions?: TGroundingOmission[] };
export type TVerifiedResearchGraph = { graph_id: string; graph: TResearchGraph; evidence_ids: string[] };
export type TResearchBundle = {
  context_markdown?: string;
  pitch_markdown?: string;
  verified_graphs?: TVerifiedResearchGraph[];
  pitch_chart?: TPitchChartSelection | null;
  pitch_script?: TPitchPassage[];
  grounding?: TGrounding;
  research_id: string;
  brief_id: string;
  markdown?: string;
  confirmed_brief: TResearchBrief;
  findings: Pick<TResearchDraft, "title" | "sections">;
  evidence: TEvidence[];
  gaps: string[];
};

export type TSearchHit = { passage: string; url: string; title: string };
export type TGraphRepairInput = {
  feedback: string[];
  rejected: { name: string; type: "bar" | "line"; labels: string[]; periods: string[] }[];
  evidence: Pick<TEvidence, "id" | "location" | "url" | "passage">[];
};
export type TResearchProvider = {
  collect_step?: TModelStep;
  clarify: (scope: { messages: string[]; history?: TInterviewTurn[]; urls: string[]; source_policy: TSourcePolicy; previous_question?: string | null }, signal: AbortSignal) => Promise<TBriefReview>;
  lookup: (query: string, url: string | undefined, signal: AbortSignal,
    observed?: (action: "search" | "open" | "find" | "failed") => void, mode?: "discovery") => Promise<TSearchHit[]>;
  verify?: (review: TGroundingReview, signal: AbortSignal, on_attempt?: (attempt: TAttempt) => void) => Promise<TGroundingReviewResult>;
  repair_graph?: (input: TGraphRepairInput, signal: AbortSignal) => Promise<string | null>;
  draft: (brief: string, evidence: TEvidence[], gaps: string[], signal: AbortSignal, reference_mode?: "context") => Promise<TResearchDraft>;
};
