import type { ModelMessage } from "ai";
import type { TAttempt, TModelStep } from "./ai";
import type { TEvidence, TResearchBrief, TSearchHit } from "./research";
import type { TRecordActivity } from "./research-job";

type TResearchTarget = {
  id: string;
  kind: "read" | "search";
  item_id?: string;
  value: string;
  label: string;
  seed?: boolean;
  attempted?: boolean;
  status?: "read" | "empty" | "failed";
  canonical_url?: string;
  evidence_ids?: string[];
  discovered_ids?: string[];
};

// One question the finished brief must answer. It is covered only by a verbatim excerpt from a read source.
export type TCoverageItem = {
  id: string;
  question: string;
  needs: "number" | "fact";
  status: "open" | "covered" | "unavailable";
  lookups: number;
  answer?: string;
  // A short slide-style heading that states the answer, written with it.
  heading?: string;
  evidence_id?: string;
  excerpt?: string;
  reason?: string;
};

export type TResearchAgentState = {
  version: 4;
  brief_id: string;
  started_at: number;
  steps: number;
  // Rounds of public search, shown to the host as research passes.
  pass: number;
  lookup_attempts: number;
  completed_lookups: number;
  read_pages?: number;
  model_attempts: TAttempt[];
  messages: ModelMessage[];
  targets: TResearchTarget[];
  checklist: TCoverageItem[];
  evidence: TEvidence[];
  gaps: string[];
  research_notes?: string;
  stop_reason?: "finished" | "budget";
};

type TLegacyResearchState = Omit<TResearchAgentState, "version" | "pass" | "checklist"> & { version: 2 | 3; pass?: number };
export type TResearchCollectionCheckpoint =
  | Omit<TResearchAgentState, "evidence" | "gaps" | "completed_lookups">
  | Omit<TLegacyResearchState, "evidence" | "gaps" | "completed_lookups">;

export type TCollectResearch = {
  brief: TResearchBrief;
  presentation_coverage?: { slide_count: number; gaps: string[]; existing_findings: string[] };
  evidence: TEvidence[];
  gaps: string[];
  previous?: TResearchAgentState | TLegacyResearchState;
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
