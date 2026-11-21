export type TResearchSession = { session_id: string; token: string };
export type TSourcePolicy = "files_only" | "public_search";
export type TBriefInput = {
  message: string;
  source_policy: TSourcePolicy;
  materials: string;
  urls: string[];
  brief_id?: string;
};
export type TResearchBrief = {
  brief_id: string;
  summary: string;
  question: string | null;
  public_queries: string[];
};
export type TResearchResult = {
  research_id: string;
  markdown: string;
  gaps: string[];
};

export type TResearchMemoProps = { markdown: string };
export type TMemoCitation = { id: string; label: string; href?: string; detail?: string };
