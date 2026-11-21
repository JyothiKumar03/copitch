import type { TGrounding, TEvidence, TResearchDraft } from "./research";

export type TResearchCheckpoint = {
  completed_lookups: number;
  evidence: TEvidence[];
  gaps: string[];
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
  | "lookup_failed" | "lookup_empty" | "sources_saved" | "draft_started" | "verification_started"
  | "verified" | "fallback" | "completed" | "failed" | "superseded";

export type TResearchActivity = { sequence: number; kind: TActivityKind; label: string };
export type TRecordActivity = (kind: TActivityKind, label: string) => void;

export type TResearchJob = {
  activity: TResearchActivity[];
  job_id: string;
  brief_id: string;
  status: "queued" | "running" | "completed" | "failed" | "superseded";
  completed_lookups: number;
  result?: { research_id: string; markdown: string; gaps: string[] };
  error?: string;
};
