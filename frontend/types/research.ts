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
export type TResearchWorkspace = { artifacts?: { research_id: string; after_turn: number }[]; job?: TResearchJob | null; capabilities?: { source_uploads?: boolean }; brief: TSavedBrief | null; research: TResearchResult | null };

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
export type TInterviewMessage = { role: "host" | "assistant"; text: string };

export type TUploadedSource = {
  source_id: string;
  filename: string;
  kind: "pdf" | "pptx" | "csv";
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
