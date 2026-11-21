import type { TPitchContent } from "../types/pitch-content";
import type { TResearchBundle } from "../types/research";

export const pitch_content = (bundle: TResearchBundle): TPitchContent => {
  const script = bundle.grounding?.mode === "verified" ? bundle.pitch_script : undefined;
  const labels = { opening: "Opening", point: "Talking point", close: "Closing ask" };
  const passages = script?.length ? script.map(item => ({
    label: labels[item.purpose], text: item.prose,
    evidence_ids: [...new Set(item.support.map(ref => ref.evidence_id))],
  })) : (bundle.grounding ? bundle.findings?.sections ?? [] : []).flatMap(section => section.paragraphs.map(item => ({
    label: section.heading, text: item.prose,
    evidence_ids: [...new Set(item.support.map(ref => ref.evidence_id))],
  })));
  const used = new Set(passages.flatMap(passage => passage.evidence_ids));
  const sources = (bundle.evidence ?? []).filter(item => used.has(item.id))
    .map(({ id, location, url }) => ({ id, location, url }));
  return { title: bundle.findings?.title || "Pitch content", format: script?.length ? "script" : "talking_points",
    passages, sources, gaps: bundle.gaps ?? [] };
};
