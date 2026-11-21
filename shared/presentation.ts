export const MAX_PRESENTATION_SLIDES = 12;
export const MAX_DECK_REVIEW_PASSES = 3;

export type TPresentationReadiness = {
  status: "ready" | "limited";
  basis: "model" | "verified_findings";
  reason: string;
  gaps: string[];
};
export type TDeckPreparationPhase = "checking_evidence" | "researching_gaps" | "planning_slides" | "reviewing_slides";

export const publicSourceLabels = (
  sources: readonly { id: string; origin: string; url?: string }[] | undefined,
  evidenceIds: readonly string[],
) => [...new Set(evidenceIds.flatMap(id => {
  const source = sources?.find(item => item.id === id);
  if (source?.origin === "material") return ["Supplied material"];
  if (source?.origin !== "public" || !source.url) return [];
  try {
    const url = new URL(source.url);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname
      ? [url.hostname.replace(/^www\./u, "")] : [];
  } catch { return []; }
}))].slice(0, 3);
