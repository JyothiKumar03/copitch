import type { TResearchSession } from "./research";

export type TPitchContent = {
  title: string;
  format: "script" | "talking_points";
  passages: { label: string; text: string; evidence_ids: string[] }[];
  sources: { id: string; location: string; url?: string }[];
  gaps: string[];
};

export type TPitchContentProps = {
  researchId: string;
  getSession: () => Promise<TResearchSession>;
};
