import { AppError } from "../errors/app-error";
import { z } from "zod";
import { chart_for_findings } from "./conversion-metrics";
import { public_url } from "./research";
import type { TDeck, TSlide, TSlideChanges } from "../types/deck";
import type { TResearchBundle } from "../types/research";
import { quotes } from "./excerpt";
import { presentation_sentences } from "./presentation-live";

const is_plain_text = (text: string) => !/<\/?[a-z][\w:-]*(?:\s[^<>]*)?\s*\/?>/i.test(text);
const plain_text = (max: number) => z.string().trim().min(1).max(max).refine(is_plain_text, "Use plain text in slide fields");
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
const chart_template_fields = {
  unit: z.string().trim().max(24).refine(is_plain_text, "Use plain text in slide fields"),
  points: z.array(z.strictObject({ label: plain_text(72), value: z.number().finite() })).min(2).max(8),
};
// Use a regular union so the provider JSON schema contains the supported anyOf keyword.
export const slide_template_schema = z.union([
  z.strictObject({ type: z.enum(["title_card"]) }),
  z.strictObject({ type: z.enum(["bullet_slide"]) }),
  z.strictObject({ type: z.enum(["metric_grid"]),
    metrics: z.array(z.strictObject({ label: plain_text(72), value: plain_text(40) })).min(1).max(4) }),
  z.strictObject({ type: z.enum(["timeline"]),
    entries: z.array(z.strictObject({ date: plain_text(40), label: plain_text(110) })).min(2).max(4) }),
  z.strictObject({ type: z.enum(["quote"]), quote: plain_text(220), attribution: plain_text(72).nullable() }),
  z.strictObject({ type: z.enum(["comparison"]),
    columns: z.array(z.strictObject({ label: plain_text(72), points: z.array(plain_text(110)).min(1).max(3) })).length(2) }),
  z.strictObject({ type: z.enum(["bar_chart"]), ...chart_template_fields }),
  z.strictObject({ type: z.enum(["line_chart"]), ...chart_template_fields }),
  z.strictObject({ type: z.enum(["donut_chart"]), ...chart_template_fields }),
]);
export const live_edit_input = edit_input.extend({
  changes: z.strictObject({ ...fields, template: slide_template_schema }).partial()
    .refine(value => Object.keys(value).length > 0, "Supply an edit"),
});
const slide_schema = z.strictObject({
  ...fields, chart: chart_schema.optional(), slide_id: z.string().min(1), evidence_ids: z.array(z.string().min(1)),
  template: slide_template_schema.optional(), beat_id: z.string().min(1).optional(), estimated_seconds: z.number().int().positive().optional(),
  sentences: z.array(z.strictObject({ sentence_id: z.string().min(1), text: plain_text(1800), evidence_ids: z.array(z.string().min(1)) })).optional(),
});

const words = new Intl.Segmenter(undefined, { granularity: "word" });

export const slide_speaking_seconds = (narration: string) => {
  let word_count = 0;
  for (const part of words.segment(narration)) if (part.isWordLike) word_count++;
  return 3 + Math.ceil(word_count * 60 / 135);
};

export const deck_sources = (bundle: TResearchBundle, used: Set<string>) => bundle.evidence.filter(item => used.has(item.id)).map(item => ({
  id: item.id,
  origin: item.origin,
  location: item.origin === "public" ? item.location : "Host-provided source",
  url: item.origin === "public" && item.url ? public_url(item.url) : undefined,
}));

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
          quotes(by_id.get(ref.evidence_id)?.passage, ref.excerpt))) {
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
  const sources = deck_sources(bundle, used);
  return { deck_id: crypto.randomUUID(), research_id: bundle.research_id, revision: 1,
    grounding_mode: bundle.grounding?.mode, sources, ...checked.data };
};

export const propose_slide = (before: TSlide, changes: TSlideChanges): TSlide => {
  const merged = { ...before, ...changes };
  if (changes.template) delete merged.chart;
  if (changes.narration !== undefined && changes.narration !== before.narration) {
    delete merged.sentences;
    if (before.sentences) {
      const old = [...before.sentences];
      merged.sentences = presentation_sentences(merged).map(sentence => {
        const index = old.findIndex(item => item.text === sentence.text);
        if (index >= 0) return old.splice(index, 1)[0];
        return { sentence_id: `${before.slide_id}:edit:${crypto.randomUUID()}`, text: sentence.text, evidence_ids: [...before.evidence_ids] };
      });
    }
    if (before.estimated_seconds) merged.estimated_seconds = slide_speaking_seconds(merged.narration);
  }
  const after = slide_schema.parse(merged);
  if (JSON.stringify(after.highlights) === JSON.stringify(before.highlights) && after.title === before.title &&
      after.layout === before.layout && after.narration === before.narration && JSON.stringify(after.template) === JSON.stringify(before.template)) {
    throw new AppError(400, "The proposed slide is unchanged");
  }
  return after;
};
