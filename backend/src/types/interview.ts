import type { TResearchJob } from "./research-job";
import type { TSourceSummary } from "./source";
import type { TInterviewTurn, TResearchBrief, TResearchBundle } from "./research";
import type { TResearchProposal, TStudioActivity, TStudioPhase, TStudioState } from "./studio-turn";

export type TInterviewBrief = Pick<TResearchBrief, "brief_id" | "summary" | "question" | "public_queries" | "intent"> & {
  sources: TSourceSummary[];
  spoken_prompt: string;
  history: TInterviewTurn[];
};

export type TInterviewWorkspace = {
  history: TInterviewTurn[];
  sources: TSourceSummary[];
  activities: (TStudioActivity & { turn_id: string })[];
  pending_question: null;
  phase: TStudioPhase;
  proposal: TResearchProposal | null;
  state: TStudioState;
  artifacts?: { research_id: string; after_turn: number }[];
  job: TResearchJob | null;
  capabilities: { source_uploads: boolean };
  brief: (TInterviewBrief & Pick<TResearchBrief, "materials" | "source_policy" | "urls">) | null;
  research: Pick<TResearchBundle, "research_id" | "markdown" | "gaps"> | null;
};
