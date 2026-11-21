import type { TResearchJob } from "./research-job";
import type { TSourceSummary } from "./source";
import type { TInterviewTurn, TResearchBrief, TResearchBundle } from "./research";

export type TInterviewBrief = Pick<TResearchBrief, "brief_id" | "summary" | "question" | "public_queries"> & {
  sources: TSourceSummary[];
  spoken_prompt: string;
  history: TInterviewTurn[];
};

export type TInterviewWorkspace = {
  artifacts?: { research_id: string; after_turn: number }[];
  job: TResearchJob | null;
  capabilities: { source_uploads: boolean };
  brief: (TInterviewBrief & Pick<TResearchBrief, "materials" | "source_policy" | "urls">) | null;
  research: Pick<TResearchBundle, "research_id" | "markdown" | "gaps"> | null;
};
