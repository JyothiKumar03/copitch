import { selected_chart } from "./pitch-chart";
import type {
  TEvidence, TGroundingReview, TGroundingUnit, TResearchDraft, TResearchProvider,
} from "../types/research";

const review_payload = (draft: TResearchDraft, evidence: TEvidence[], gaps: string[]): TGroundingReview => {
  const units: TGroundingUnit[] = [{ id: "title", kind: "title", text: draft.title, support: [] }];
  for (const [i, section] of draft.sections.entries()) {
    const support = section.paragraphs.flatMap(p => p.support);
    units[0].support.push(...support);
    units.push({ id: "section-" + i, kind: "heading", text: section.heading, support });
    for (const [j, p] of section.paragraphs.entries()) {
      units.push({ id: "paragraph-" + i + "-" + j, kind: "paragraph", text: p.prose, support: p.support });
    }
  }
  for (const [index, passage] of (draft.pitch_script ?? []).entries()) {
    units.push({ id: "pitch-" + index, kind: "paragraph", text: passage.prose, support: passage.support });
  }
  const chart = selected_chart(draft.pitch_chart,evidence);
  if (chart) {
    const ids = new Set(chart.data.map(point => point.evidence_id));
    units.push({ id:"pitch-chart",kind:"paragraph",text:JSON.stringify(chart),
      support:evidence.filter(row => ids.has(row.id)).map(row => ({evidence_id:row.id,excerpt:row.passage})) });
  }
  return { units, evidence, gaps: [...gaps, ...draft.gaps] };
};

export const verify_draft = async (draft: TResearchDraft, evidence: TEvidence[], gaps: string[],
  provider: TResearchProvider, signal: AbortSignal, on_verify?: () => void): Promise<{prose:boolean;chart:boolean}> => {
  const withheld = { prose:false,chart:false };
  if (!provider.verify || signal.aborted) return withheld;
  const review = review_payload(draft, evidence, gaps);
  if (review.units.length > 40 || Buffer.byteLength(JSON.stringify(review), "utf8") > 48000) return withheld;
  on_verify?.();
  try {
    const verdicts = await provider.verify(review, AbortSignal.any([signal, AbortSignal.timeout(20000)]));
    const decisions = new Map(verdicts.map(v => [v.id,v.decision]));
    if (signal.aborted || verdicts.length !== review.units.length || decisions.size !== review.units.length ||
      !review.units.every(unit => ["supported","unsupported","missing_qualification"].includes(decisions.get(unit.id) ?? ""))) return withheld;
    return {
      prose:review.units.every(unit => unit.id === "pitch-chart" || decisions.get(unit.id) === "supported"),
      chart:decisions.get("pitch-chart") === "supported",
    };
  } catch {
    return withheld;
  }
};

// Use complete records so a selected phrase cannot discard a qualification later in its passage.
// Long, split materials and host instructions are unsuitable for unattended extractive publication.
export const source_extracts = (evidence: TEvidence[], draft?: TResearchDraft): TResearchDraft => {
  const cited = draft && new Set(draft.sections.flatMap(s => s.paragraphs.flatMap(p => p.support.map(r => r.evidence_id))));
  const material_parts = evidence.filter(e => e.origin === "material" && !e.source_id).length;
  const sources = evidence.filter(e => e.origin !== "host" && (!cited || cited.has(e.id)) &&
    !(e.origin === "material" && !e.source_id && material_parts > 1) && !(e.origin === "public" && e.passage.length >= 1400) && e.passage.trim().length > 0 &&
    e.passage.length <= 1600 && !/<\/?[a-z][\w:-]*(?:\s[^<>]*)?\s*\/?>/i.test(e.passage)).slice(0, 6);
  return { title: "Source extracts", gaps: [], sections: [{
    heading: "Reported evidence",
    paragraphs: sources.map(e => {
      const attribution = e.origin === "public" ? "The retrieved source summary states" : "The supplied material states";
      return { prose: attribution + " “" + e.passage.trim() + "” Review the source limitations before drawing a causal conclusion.",
        support: [{ evidence_id: e.id, excerpt: e.passage.trim() }] };
    }),
  }] };
};
