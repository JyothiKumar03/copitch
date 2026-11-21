import type { TInterviewLanguage } from "../../shared/languages";

export type TResearchSession = { session_id: string; token?: string };
export type TSourcePolicy = "files_only" | "public_search";
export type TBriefInput = {
  message: string;
  source_policy: TSourcePolicy;
  materials: string;
  urls: string[];
  brief_id?: string;
  source_ids?: string[];
};
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

export type TResearchMemoProps = { markdown: string };
export type TMemoCitation = { id: string; label: string; href?: string; detail?: string };
export type TSavedBrief = TResearchBrief & { source_ids?: string[]; sources?: TUploadedSource[]; source_policy: TSourcePolicy; materials: string; urls: string[] };
export type TResearchWorkspace = {
  history?: TInterviewMessage[];
  pending_question?: TStudioQuestion | null;
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
  status: "queued" | "running" | "completed" | "failed" | "superseded";
  completed_lookups: number;
  result?: TResearchResult;
  error?: string;
};

export type TInterviewStart = { greeting: string; workspace: TResearchWorkspace };
export type TInterviewMessage = { role: "host" | "assistant"; text: string; turn_id?: string; created_at?: number; intent?: string; answer_to?: string; option_id?: string };

export type TUploadedSource = {
  source_id: string;
  filename: string;
  kind: "pdf" | "ppt" | "pptx" | "csv";
  locations: number;
};

export type TResearchActivity = {
  sequence: number;
  kind: "queued" | "started" | "resumed" | "lookup_requested" | "search_completed" | "page_opened" |
    "lookup_failed" | "lookup_empty" | "sources_saved" | "draft_started" | "verification_started" |
    "verified" | "fallback" | "completed" | "failed" | "superseded";
  label: string;
};
export type TInstrumentState = "ready" | "connecting" | "listening" | "recording" | "transcribing" | "thinking" | "speaking" | "researching" | "complete";

export type TArchivedPitch = { researchId: string; afterTurn: number };

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

export type TTurnInput = {
  turn_id: string;
  replace_scope?: boolean;
  answer_to?: string;
  option_id?: string;
  input: "typed" | "speech";
  message: string;
  brief_id?: string;
  source_ids?: string[];
  source_policy?: TSourcePolicy;
  urls?: string[];
  materials?: string;
};

export type TTurnActivity = { turn_id: string; tool: string; status: string; result: string; question?: TStudioQuestion };

export type TStudioQuestion = {
  request_id: string;
  turn_id: string;
  kind: "subject" | "audience" | "decision" | "source_url" | "reference" | "approval";
  question: string;
  options: { id: string; label: string }[];
  allow_free_text: boolean;
  brief_id: string | null;
};
