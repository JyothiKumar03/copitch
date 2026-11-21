import { AppError } from "../errors/app-error";
import { z } from "zod";
import { chart_for_findings } from "./conversion-metrics";
import { public_url } from "./research";
import type { TDeck, TSlide, TSlideChanges } from "../types/deck";
import type { TResearchBundle } from "../types/research";

const plain_text = (max: number) => z.string().trim().min(1).max(max)
  .refine(text => !/<\/?[a-z][\w:-]*(?:\s[^<>]*)?\s*\/?>/i.test(text), "Use plain text in slide fields");
const fields = {
  layout: z.enum(["headline", "evidence", "takeaway"]),
  title: plain_text(160),
  highlights: z.array(plain_text(240)).min(1).max(4),
  narration: plain_text(12000),
};
export const edit_input = z.strictObject({
  command_id: z.string().trim().min(1).max(128),
  base_revision: z.number().int().positive(),
  slide_id: z.string().trim().min(1).max(128),
  changes: z.strictObject(fields).partial().refine(value => Object.keys(value).length > 0, "Supply an edit"),
});
const chart_schema = z.object({ period: z.string().nullable(), rows: z.array(z.object({
  label: z.string(), numerator: z.number().int().nonnegative(), denominator: z.number().int().nonnegative(), evidence_id: z.string(),
})).min(1).max(4) });
const slide_schema = z.strictObject({ ...fields, chart: chart_schema.optional(), slide_id: z.string().min(1), evidence_ids: z.array(z.string().min(1)) });

// Use a complete sentence or quoted supporting passage in the visual layer. Keep the full prose for speech.
const highlight = (prose: string, excerpts: string[], heading: string) => {
  const first_sentence = prose.match(/^.+?[.!?](?:\s|$)/su)?.[0]?.trim();
  return [first_sentence, ...excerpts, prose, heading].find(candidate =>
    candidate && candidate.length <= 240) || "Research findings";
};

export const compile_deck = (bundle: TResearchBundle): TDeck => {
  if (!bundle.findings || !bundle.confirmed_brief) {
    throw new AppError(422, "This older report needs a new research run to compile a deck");
  }
  const by_id = new Map(bundle.evidence.map(item => [item.id, item]));
  const title = bundle.findings.title.trim();
  const slides: TSlide[] = [];
  for (const section of bundle.findings.sections) {
    for (let offset = 0; offset < section.paragraphs.length; offset += 3) {
      const group = section.paragraphs.slice(offset, offset + 3);
      const evidence_ids = new Set<string>();
      const highlights: string[] = [];
      for (const paragraph of group) {
        if (!paragraph.support.length || !paragraph.support.every(ref =>
          ref.excerpt.trim() && by_id.get(ref.evidence_id)?.passage.includes(ref.excerpt))) {
          throw new AppError(422, "A saved finding has an unresolved evidence reference");
        }
        for (const ref of paragraph.support) evidence_ids.add(ref.evidence_id);
        if (bundle.grounding?.mode === "source_extracts") {
          highlights.push(paragraph.prose.length <= 240 ? paragraph.prose : "See the full source passage in the research memo.");
        } else {
          highlights.push(highlight(paragraph.prose, paragraph.support.map(ref => ref.excerpt), section.heading));
        }
      }
      const chart = chart_for_findings(evidence_ids, bundle.evidence);
      if (chart) chart.rows.forEach(row => evidence_ids.add(row.evidence_id));
      slides.push({
        ...(chart && { chart }),
        slide_id: "slide-" + (slides.length + 1), layout: "evidence", title: section.heading,
        highlights, narration: group.map(paragraph => paragraph.prose).join("\n\n"), evidence_ids: [...evidence_ids],
      });
    }
  }
  if (!slides.length) throw new AppError(422, "No supported findings to present. Add evidence and run research again.");
  slides[0].layout = "headline";
  if (slides.length > 1) slides[slides.length - 1].layout = "takeaway";
  const checked = z.object({ title: plain_text(200), slides: z.array(slide_schema).min(1).max(100) })
    .safeParse({ title, slides });
  if (!checked.success) throw new AppError(422, "The findings exceed the supported slide structure");
  const used = new Set(slides.flatMap(slide => slide.evidence_ids));
  const sources = bundle.evidence.filter(item => used.has(item.id)).map(item => ({
    id: item.id,
    origin: item.origin,
    location: item.origin === "public" ? item.location : "Host-provided source",
    url: item.origin === "public" && item.url ? public_url(item.url) : undefined,
  }));
  return { deck_id: crypto.randomUUID(), research_id: bundle.research_id, revision: 1,
    grounding_mode: bundle.grounding?.mode, sources, ...checked.data };
};

export const propose_slide = (before: TSlide, changes: TSlideChanges): TSlide => {
  const after = slide_schema.parse({ ...before, ...changes });
  if (JSON.stringify(after.highlights) === JSON.stringify(before.highlights) && after.title === before.title &&
      after.layout === before.layout && after.narration === before.narration) {
    throw new AppError(400, "The proposed slide is unchanged");
  }
  return after;
};
