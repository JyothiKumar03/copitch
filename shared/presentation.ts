export const MAX_PRESENTATION_SLIDES = 12;
export const MAX_DECK_REVIEW_PASSES = 3;
export const DEFAULT_PRESENTATION_SLIDES = 6;

const SLIDE_COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const SLIDE_COUNT = new RegExp(`(?<![.\\p{L}\\p{N}])([0-9]+|${SLIDE_COUNT_WORDS.join("|")})[\\s\\p{Pd}]*(?:slides?|pages?)\\b`, "giu");

export const extractPresentationSlideCount = (...messages: readonly string[]): number | undefined => {
  for (const message of [...messages].reverse()) {
    const match = [...message.normalize("NFKC").matchAll(SLIDE_COUNT)].at(-1);
    if (!match) continue;
    const digit = Number(match[1]);
    const count = Number.isSafeInteger(digit) ? digit : SLIDE_COUNT_WORDS.indexOf(match[1].toLowerCase());
    if (count >= 0) return count;
  }
};

export type TPresentationReadiness = {
  status: "ready" | "limited";
  basis: "model" | "verified_findings";
  reason: string;
  gaps: string[];
};
export type TDeckPreparationPhase = "checking_evidence" | "researching_gaps" | "planning_slides" | "reviewing_slides";
export type TDeckPreparationFailure = {
  reason_code: "insufficient_evidence" | "grounding_failed" | "render_review_failed" | "provider_unavailable" | "interrupted" | "preparation_failed";
  message: string;
  gaps: string[];
  supported_slide_count: number;
  requested_slide_count?: number;
  partial_deck_id?: string;
};
export type TDeckRecoverySlide = {
  slide_id: string;
  title: string;
  highlights: string[];
  narration: string;
  evidence_ids: string[];
  status: "verified" | "blank" | "edited";
};
export type TDeckRecoveryDraft = {
  draft_id: string;
  research_id: string;
  revision: number;
  requested_slide_count: number;
  slides: TDeckRecoverySlide[];
};
export type TDeckCommandReceipt = { research_id: string; slide_count: number; job_id?: string; deck_id?: string };

export const publicSourceLabels = (
  sources: readonly { id: string; origin: string; url?: string }[] | undefined,
  evidenceIds: readonly string[],
) => [...new Set(evidenceIds.flatMap(id => {
  const source = sources?.find(item => item.id === id);
  // Captured website pages are public material and keep their site name. Other supplied files stay generic.
  if (source?.origin === "material" && !source.url) return ["Supplied material"];
  if (source?.origin !== "public" && source?.origin !== "material" || !source.url) return [];
  try {
    const url = new URL(source.url);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname
      ? [url.hostname.replace(/^www\./u, "")] : [];
  } catch { return []; }
}))].slice(0, 3);
