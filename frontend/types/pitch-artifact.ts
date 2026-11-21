import type { TResearchGraph } from "../../shared/research-graphs";

export type TContextPreview = {
  markdown: string;
  graphs: ReadonlyMap<number, TResearchGraph>;
  rejectedGraphs: number;
};

export type TContextArtifact = { markdown: string; preview: TContextPreview };
