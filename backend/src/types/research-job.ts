import type { TGrounding, TEvidence, TResearchDraft } from "./research";
import type { TResearchCollectionCheckpoint } from "./research-agent";

export type TResearchCheckpoint = {
  completed_lookups: number;
  evidence: TEvidence[];
  gaps: string[];
  draft_attempts?: number;
  draft_feedback?: string[];
  verified_candidate?: { draft: TResearchDraft; grounding: TGrounding };
  collection?: TResearchCollectionCheckpoint;
  draft?: TResearchDraft;
  grounding?: TGrounding;
};

export type TResearchLease = {
  attempts: number;
  job_id: string;
  session_id: string;
  brief_id: string;
  token: string;
  checkpoint?: TResearchCheckpoint;
};

export type TActivityKind =
  | "queued" | "started" | "resumed" | "lookup_requested" | "search_completed" | "page_opened"
  | "lookup_failed" | "lookup_empty" | "sources_saved" | "draft_started" | "verification_started" | "verification_skipped"
  | "verified" | "fallback" | "completed" | "failed" | "needs_input" | "superseded";

export type TResearchActivity = { sequence: number; kind: TActivityKind; label: string };
export type TRecordActivity = (kind: TActivityKind, label: string) => void;

export type TResearchJob = {
  activity: TResearchActivity[];
  job_id: string;
  brief_id: string;
  status: "queued" | "running" | "completed" | "failed" | "needs_input" | "superseded";
  completed_lookups: number;
  tool_steps?: number;
  research_passes?: number;
  read_pages?: number;
  result?: { research_id: string; markdown?: string; gaps: string[] };
  error?: string;
};
