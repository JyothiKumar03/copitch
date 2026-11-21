import type { TInterviewLanguage } from "../../shared/languages";

export type TResearchSession = { session_id: string; token?: string };
export type TContextArtifactProps = { project: string; researchId: string; getSession: () => Promise<TResearchSession> };
export type TSourcePolicy = "files_only" | "public_search";
export type TResearchBrief = {
  brief_id: string;
  summary: string;
  question: string | null;
  spoken_prompt?: string;
  history?: TInterviewMessage[];
  public_queries: string[];
};
export type TResearchResult = {
  research_id: string;
  markdown: string;
  gaps: string[];
};

export type TSavedBrief = TResearchBrief & { source_ids?: string[]; sources?: TUploadedSource[]; source_policy: TSourcePolicy; materials: string; urls: string[] };
export type TStudioPhase = "interview" | "proposed" | "researching" | "done";
export type TResearchProposal = {
  proposal_id: string;
  summary: string;
  queries: string[];
  urls: string[];
  source_policy: TSourcePolicy;
};
export type TProposalChoice = "approve" | "edit";
export type TResearchWorkspace = {
  phase?: TStudioPhase;
  proposal?: TResearchProposal | null;
  state?: {
    reply_language: string | null;
    proposal_turn_id?: string | null;
    materials: string;
    source_ids: string[];
    urls?: string[];
    source_policy?: TSourcePolicy;
  };
  history?: TInterviewMessage[];
  activities?: TTurnActivity[];
  sources?: TUploadedSource[];
  context?: {
    language_preference?: TInterviewLanguage | null;
    materials?: string;
    reviewable_brief_id?: string | null;
    source_policy?: TSourcePolicy;
    entities?: { urls?: string[] };
    pending?: {url: string; phrase: string} | null;
  };
  artifacts?: { research_id: string; after_turn: number }[]; job?: TResearchJob | null; capabilities?: { source_uploads?: boolean }; brief: TSavedBrief | null; research: TResearchResult | null };

export type TResearchJob = {
  activity?: TResearchActivity[];
  job_id: string;
  brief_id: string;
  status: "queued" | "running" | "completed" | "failed" | "needs_input" | "superseded";
  completed_lookups: number;
  tool_steps?: number;
  research_passes?: number;
  read_pages?: number;
  result?: TResearchResult;
  error?: string;
};

export type TInterviewStart = { greeting: string; workspace: TResearchWorkspace };
export type TInterviewMessage = { role: "host" | "assistant"; text: string; turn_id?: string; created_at?: number; intent?: string; answer_to?: string; option_id?: string;
  voice_items?: string[] };

export type TUploadedSource = {
  source_id: string;
  filename: string;
  kind: "pdf" | "ppt" | "pptx" | "csv";
  locations: number;
};

export type TResearchActivity = {
  sequence: number;
  kind: "queued" | "started" | "resumed" | "lookup_requested" | "search_completed" | "page_opened" |
    "lookup_failed" | "lookup_empty" | "sources_saved" | "draft_started" | "verification_started" | "verification_skipped" |
    "verified" | "fallback" | "completed" | "failed" | "needs_input" | "superseded";
  label: string;
};
export type TInstrumentState = "ready" | "connecting" | "listening" | "recording" | "transcribing" | "thinking" | "speaking" | "researching" | "complete";


export type TSourceCall = {
  call_id: string;
  tool: "parse_pdf" | "parse_ppt" | "parse_pptx" | "parse_csv";
  filename: string;
  status: "running" | "succeeded" | "failed";
  started_at: string;
  finished_at: string | null;
  source: TUploadedSource | null;
  error: string | null;
};

export type TStudioSources = {
  source_ids: string[];
  source_policy: TSourcePolicy;
  urls: string[];
  materials: string;
  expected_proposal_id: string | null;
};

export type TTurnInput = {
  turn_id: string;
  replace_scope?: boolean;
  answer_to?: string;
  option_id?: TProposalChoice;
  input: "typed" | "speech";
  message: string;
  brief_id?: string;
  source_ids?: string[];
  source_policy?: TSourcePolicy;
  urls?: string[];
  materials?: string;
};

export type TTurnActivity = { turn_id: string; tool: string; status: string; result: string };
