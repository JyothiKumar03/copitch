export const MAX_PRESENTATION_SLIDES = 12;
export const MAX_DECK_REVIEW_PASSES = 3;

export type TPresentationReadiness = {
  status: "ready" | "limited";
  basis: "model" | "verified_findings";
  reason: string;
  gaps: string[];
};
