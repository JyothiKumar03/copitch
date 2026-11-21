export type TSourcePolicy = "files_only" | "public_search";

export type TBriefReview = {
  summary: string;
  question: string | null;
  public_queries: string[];
};

export type TResearchBrief = TBriefReview & {
  brief_id: string;
  source_policy: TSourcePolicy;
  messages: string[];
  materials: string;
  urls: string[];
};

export type TEvidence = {
  id: string;
  origin: "host" | "material" | "public";
  location: string;
  passage: string;
  url?: string;
};

export type TResearchDraft = {
  title: string;
  sections: { heading: string; paragraphs: { prose: string; support: { evidence_id: string; excerpt: string }[] }[] }[];
  gaps: string[];
};

export type TResearchBundle = {
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
  clarify: (scope: { messages: string[]; urls: string[]; source_policy: TSourcePolicy; previous_question?: string | null }, signal: AbortSignal) => Promise<TBriefReview>;
  lookup: (query: string, url: string | undefined, signal: AbortSignal) => Promise<TSearchHit[]>;
  draft: (brief: string, evidence: TEvidence[], gaps: string[], signal: AbortSignal) => Promise<TResearchDraft>;
};
