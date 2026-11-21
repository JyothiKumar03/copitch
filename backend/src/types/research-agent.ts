import type { ModelMessage } from "ai";
import type { TAttempt, TModelStep } from "./ai";
import type { TEvidence, TResearchBrief, TSearchHit } from "./research";
import type { TRecordActivity } from "./research-job";

type TResearchTarget = {
  id: string;
  kind: "read" | "search";
  value: string;
  label: string;
  seed?: boolean;
  attempted?: boolean;
  status?: "read" | "empty" | "failed";
  canonical_url?: string;
  evidence_ids?: string[];
  discovered_ids?: string[];
};

export type TResearchContinuation = {
  gap: string;
  reason: string;
  target_id: string;
  tool: "read_url" | "web_search";
};

export type TResearchAgentState = {
  version: 3;
  brief_id: string;
  started_at: number;
  steps: number;
  pass: 1 | 2;
  pass_steps: number;
  lookup_attempts: number;
  completed_lookups: number;
  read_pages?: number;
  model_attempts: TAttempt[];
  messages: ModelMessage[];
  targets: TResearchTarget[];
  evidence: TEvidence[];
  gaps: string[];
  research_notes?: string;
  continuation?: TResearchContinuation;
  stop_reason?: "finished" | "budget";
};

type TResearchAgentStateV2 = Omit<TResearchAgentState, "version" | "pass" | "pass_steps" | "continuation"> & { version: 2 };
export type TResearchCollectionCheckpoint =
  | Omit<TResearchAgentState, "evidence" | "gaps" | "completed_lookups">
  | Omit<TResearchAgentStateV2, "evidence" | "gaps" | "completed_lookups">;

export type TCollectResearch = {
  brief: TResearchBrief;
  evidence: TEvidence[];
  gaps: string[];
  previous?: TResearchAgentState | TResearchAgentStateV2;
  checkpoint?: (state: TResearchAgentState) => void;
  model_step: TModelStep;
  lookup: (input: {
    kind: "read" | "search";
    target: string;
    known_links: readonly string[];
  }, signal: AbortSignal) => Promise<{ url?: string; hits: TSearchHit[]; links?: { url: string; title: string }[] }>;
  signal: AbortSignal;
  check_current: () => void;
  activity?: TRecordActivity;
};
