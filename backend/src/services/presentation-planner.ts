import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { z } from "zod";
import { AppError } from "../errors/app-error";
import type { TModelCandidate } from "../types/ai";
import type { TDeck, TDeckSentence, TPitchInput, TSlide, TSlideTemplate } from "../types/deck";
import type { TEvidence, TResearchBundle, TResearchProvider } from "../types/research";
import { deck_sources, slide_speaking_seconds, slide_template_schema } from "./deck";
import { quotes } from "./excerpt";
import { configured_models_for } from "./model-config";
import { presentation_planner } from "./prompts";
import { verify_draft } from "./research-grounding";
import { research_provider } from "./research-provider";

const sentences = new Intl.Segmenter(undefined, { granularity: "sentence" });
const max_beats = 12;
const short_text = (limit: number) => z.string().trim().min(1).max(limit)
  .refine(text => !/<\/?[a-z][\w:-]*(?:\s[^<>]*)?\s*\/?>/iu.test(text));
const planned_beat = z.strictObject({
  title: short_text(72),
  highlights: z.array(short_text(110)).min(1).max(4),
  template: slide_template_schema,
  evidence_ids: z.array(z.string()).max(32),
  sentences: z.array(z.strictObject({ text: short_text(320), evidence_ids: z.array(z.string()).max(12) })).min(1).max(8),
});
const planner_output = z.strictObject({
  beats: z.array(planned_beat).min(1).max(max_beats),
  rationale: short_text(600),
});

type TPlanBeat = z.infer<typeof planned_beat>;
type TBeatVisual = Pick<TPlanBeat, "title" | "highlights" | "template" | "evidence_ids">;
type TPassage = { id: string; purpose: "opening" | "point" | "close"; narration: string; sentences: TDeckSentence[]; heading?: string };
type TPlanContext = {
  brief: string;
  intent: TResearchBundle["confirmed_brief"]["intent"];
  audience: string;
  speaking_seconds: number;
  slide_count?: number;
  headings: string[];
  findings: { heading: string; text: string; evidence_ids: string[] }[];
  talk_track: { id: string; purpose: TPassage["purpose"]; narration: string; evidence_ids: string[] }[];
  evidence: Pick<TEvidence, "id" | "origin" | "passage" | "location">[];
  review_feedback?: string[];
};
export type TPlanPresentation = (context: TPlanContext, research_id: string) => Promise<unknown>;
type TPresentationPlanReview = { verified_slide_ids: string[]; feedback: string[] };
export type TVerifyPresentationPlan = (slides: TSlide[], evidence: TEvidence[], research_id: string) =>
  Promise<boolean | TPresentationPlanReview>;

const numeric_tokens = (text: string) => (text.match(/(?<![\d.,])[-+]?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?!\d|[.,]\d)/gu) ?? [])
  .map(value => Number(value.replaceAll(",", "")));

const literal_text = (passage: string, text: string) =>
  quotes(passage, text) && numeric_tokens(text).every(value => numeric_tokens(passage).includes(value));

const excerpts = (passage: string) => {
  const lines = passage.split("\n");
  return lines.flatMap((line, index) => [
    ...Array.from(sentences.segment(line), part => part.segment.trim()),
    ...(index > 0 ? [lines[index - 1] + "\n" + line] : []),
  ]).filter(text => !!text.trim());
};

export const template_supported = (template: TSlideTemplate, records: TEvidence[]) => {
  const groups = records.flatMap(record => excerpts(record.passage));
  const together = (...parts: string[]) => groups.some(group =>
    group.length <= 320 && parts.every(part => literal_text(group, part)));
  const unique_numbers = (group: string, label: string, values: number[]) => {
    const other = numeric_tokens(group.replace(label, ""));
    return other.length > 0 && other.every(value => values.includes(value)) && values.every(value => other.includes(value));
  };
  const dated_value = (label: string, value: string) => groups.some(group => group.length <= 320 &&
    literal_text(group, label) && literal_text(group, value) && unique_numbers(group, label, numeric_tokens(value)));
  switch (template.type) {
    case "metric_grid":
      return template.metrics.every(item => dated_value(item.label, item.value));
    case "timeline":
      return template.entries.every(item => dated_value(item.label, item.date));
    case "quote":
      return template.attribution ? together(template.quote, template.attribution) :
        records.some(record => literal_text(record.passage, template.quote));
    case "comparison":
      return template.columns.every(column => column.points.every(point => together(column.label, point)));
    case "bar_chart":
    case "line_chart":
    case "donut_chart":
      return new Set(template.points.map(point => point.label)).size === template.points.length &&
        (template.type !== "donut_chart" || template.points.every(point => point.value >= 0) && template.points.some(point => point.value > 0)) &&
        template.points.every(point => groups.some(group => group.length <= 320 && literal_text(group, point.label) &&
          (!template.unit || literal_text(group, template.unit)) &&
          !/(?:[<>=~≈≤≥]\s*\d|\d\s*\+|\b(?:approximately|about|at least|more than|fewer than|estimated)\b)/iu.test(group) &&
          unique_numbers(group, point.label, [point.value])));
    default:
      return true;
  }
};

const compile_beat = (beat: TBeatVisual, script: TDeckSentence[], narration: string, index: number, count: number): TSlide => {
  return {
    slide_id: "slide-" + (index + 1),
    beat_id: "beat-" + (index + 1),
    layout: index === 0 ? "headline" : index === count - 1 ? "takeaway" : "evidence",
    title: beat.title,
    highlights: beat.highlights,
    template: beat.template,
    narration,
    sentences: script,
    evidence_ids: [...new Set([...beat.evidence_ids, ...script.flatMap(sentence => sentence.evidence_ids)])],
    estimated_seconds: slide_speaking_seconds(narration),
  };
};

const trace_plan = (research_id: string, outcome: string) => {
  if (process.env.TRACE_LOGS === "1") console.log(JSON.stringify({ operation: "presentation.plan_acceptance", research_id, outcome }));
};

export const presentation_plan_review = (provider: TResearchProvider): TVerifyPresentationPlan => async (slides, evidence, research_id) => {
  const call = provider.verify;
  const traced_provider: TResearchProvider = { ...provider, verify: call && ((review, signal) => call(review, signal, attempt => {
    if (process.env.TRACE_LOGS === "1") console.log(JSON.stringify({ operation: "presentation.plan_review", research_id, ...attempt }));
  })) };
  const records = new Map(evidence.map(record => [record.id, record]));
  const support = (ids: string[]) => ids.map(evidence_id => ({ evidence_id, excerpt: records.get(evidence_id)?.passage ?? "" }));
  const sections = slides.map(slide => ({ heading: slide.title, paragraphs: [
      { prose: slide.highlights.join("\n"), support: support(slide.evidence_ids) },
      ...(slide.template && !["title_card", "bullet_slide"].includes(slide.template.type)
        ? [{ prose: JSON.stringify(slide.template), support: support(slide.evidence_ids) }] : []),
      ...(slide.sentences ?? []).map(sentence => ({ prose: sentence.text, support: support(sentence.evidence_ids) })),
    ] }));
  const result = await verify_draft({ title: "Presentation review", gaps: [], sections },
    evidence, [], traced_provider, AbortSignal.timeout(20_000));
  const verified_slide_ids = slides.flatMap((slide, index) => {
    const supported = (id: string) => result.decisions?.get(id) === "supported";
    return supported("section-" + index) &&
      sections[index].paragraphs.every((_, part) => supported(`paragraph-${index}-${part}`)) ? [slide.slide_id] : [];
  });
  trace_plan(research_id, verified_slide_ids.length === slides.length ? "independently_verified" :
    verified_slide_ids.length ? "independent_check_partial" : "independent_check_rejected");
  return { verified_slide_ids, feedback: result.feedback ?? [] };
};

export const verify_presentation_plan: TVerifyPresentationPlan = async (slides, evidence, research_id) => {
  const [model] = configured_models_for("planning");
  return model && process.env.OPENAI_API_KEY
    ? presentation_plan_review(research_provider(model, undefined, []))(slides, evidence, research_id)
    : false;
};

export const presentation_plan_provider = (config: TModelCandidate, openai = createOpenAI()): TPlanPresentation => async (context, research_id) => {
  const started = performance.now();
  let outcome = "failed";
  let usage;
  try {
    const reply = await generateText({
      model: openai.responses(config.model), maxOutputTokens: Math.min(config.max_output_tokens, 5200),
      temperature: config.temperature, maxRetries: 0, abortSignal: AbortSignal.timeout(25_000),
      providerOptions: { openai: { store: false } }, instructions: presentation_planner,
      output: Output.object({ schema: planner_output }), prompt: JSON.stringify(context),
    });
    outcome = "completed";
    usage = reply.usage;
    return reply.output;
  } finally {
    if (process.env.TRACE_LOGS === "1") console.log(JSON.stringify({
      operation: "presentation.plan", research_id, model: config.model, outcome, usage,
      duration_ms: Math.round(performance.now() - started),
    }));
  }
};

export const request_presentation_plan: TPlanPresentation = async (context, research_id) => {
  const [config] = configured_models_for("planning");
  if (config && process.env.OPENAI_API_KEY) return presentation_plan_provider(config)(context, research_id);
};

const verified_sequence = (slides: TSlide[], review: boolean | TPresentationPlanReview) => {
  if (typeof review === "boolean") return review ? slides : [];
  const verified = new Set(review.verified_slide_ids);
  let longest: TSlide[] = [];
  let current: TSlide[] = [];
  for (const slide of slides) {
    if (!verified.has(slide.slide_id)) { current = []; continue; }
    current.push(slide);
    if (current.length > longest.length) longest = current;
  }
  if (longest.length === slides.length) return slides;
  return longest.map((slide, index): TSlide => ({ ...slide,
    layout: index === 0 ? "headline" : index === longest.length - 1 ? "takeaway" : "evidence" }));
};

export const plan_verified_pitch = async (bundle: TResearchBundle, pitch: TPitchInput, plan: TPlanPresentation,
  verify: TVerifyPresentationPlan): Promise<TDeck> => {
  const records = new Map(bundle.evidence.map(record => [record.id, record]));
  const cited_records = new Set<string>();
  const supported_ids = (support: { evidence_id: string; excerpt: string }[]) => {
    if (!support.every(ref => quotes(records.get(ref.evidence_id)?.passage, ref.excerpt))) {
      throw new AppError(422, "The saved pitch has an unresolved evidence reference. Run research again before planning.");
    }
    const ids = [...new Set(support.map(ref => ref.evidence_id))];
    for (const id of ids) cited_records.add(id);
    return ids;
  };
  const approved_headings = new Map<string, string[]>();
  const findings = bundle.findings.sections.flatMap(section => {
    const result = section.paragraphs.map(paragraph => ({
      heading: section.heading, text: paragraph.prose, evidence_ids: supported_ids(paragraph.support),
    }));
    approved_headings.set(section.heading, [...new Set(result.flatMap(item => item.evidence_ids))]);
    return result;
  });
  approved_headings.set(bundle.findings.title, [...cited_records]);
  const saved_script = bundle.pitch_script?.length ? bundle.pitch_script : undefined;
  const narration_basis = saved_script
    ? saved_script.map(passage => ({ ...passage, heading: findings.find(item => item.evidence_ids.some(id =>
      passage.support.some(ref => ref.evidence_id === id)))?.heading }))
    : bundle.findings.sections.flatMap(section => section.paragraphs
      .map(paragraph => ({ ...paragraph, purpose: "point" as const, heading: section.heading })));
  const passages = narration_basis.slice(0, 55).map((passage, index): TPassage => {
    const id = "passage-" + (index + 1);
    const evidence_ids = supported_ids(passage.support);
    return { id, purpose: passage.purpose, narration: passage.prose, heading: passage.heading,
      sentences: Array.from(sentences.segment(passage.prose), part => part.segment.trim()).filter(Boolean)
        .map((text, i) => ({ sentence_id: id + "-sentence-" + (i + 1), text, evidence_ids })),
    };
  });
  if (!passages.length || passages.some(passage => !passage.sentences.length ||
      passage.purpose === "point" && !passage.sentences[0].evidence_ids.length)) {
    throw new AppError(422, "The saved pitch needs supported narration before it can be presented.");
  }
  const duration = pitch.duration_minutes * 60 - (pitch.demo?.seconds ?? 0);
  const count = Math.min(pitch.slide_count ?? max_beats, max_beats);
  const audience = pitch.audience.trim() || bundle.confirmed_brief.intent?.audience || "Audience in the confirmed brief";
  const context_records: TPlanContext["evidence"] = [];
  let record_budget = 68_000;
  for (const id of cited_records) {
    const { origin, passage, location } = records.get(id)!;
    const record = { id, origin, passage, location };
    const size = Buffer.byteLength(JSON.stringify(record), "utf8");
    if (size > record_budget) continue;
    context_records.push(record);
    record_budget -= size;
  }
  const build = (beats: TPlanBeat[]) => {
    if (!beats.length || beats.length > count) return;
    const slides: TSlide[] = [];
    const titles = new Set<string>();
    const supported_numbers = (text: string, ids: string[]) => numeric_tokens(text).every(value =>
      ids.some(id => numeric_tokens(records.get(id)?.passage ?? "").includes(value)));
    for (const beat of beats) {
      const title_key = beat.title.toLowerCase();
      if (titles.has(title_key) || !beat.evidence_ids.length || !beat.evidence_ids.every(id => cited_records.has(id))) return;
      titles.add(title_key);
      const used = beat.evidence_ids.map(id => records.get(id)!);
      if (![beat.title, ...beat.highlights].every(text => supported_numbers(text, beat.evidence_ids)) ||
          beat.sentences.some(sentence => !sentence.evidence_ids.every(id => cited_records.has(id)) ||
            !supported_numbers(sentence.text, sentence.evidence_ids))) return;
      const script = beat.sentences.flatMap(sentence => Array.from(sentences.segment(sentence.text), part => part.segment.trim())
        .filter(Boolean).map(text => ({ text, evidence_ids: [...new Set(sentence.evidence_ids)] })))
        .map((sentence, index) => ({ ...sentence, sentence_id: `beat-${slides.length + 1}-sentence-${index + 1}` }));
      const template = template_supported(beat.template, used) ? beat.template : { type: "bullet_slide" as const };
      slides.push(compile_beat({ ...beat, template }, script, script.map(sentence => sentence.text).join(" "), slides.length, beats.length));
    }
    return slides.reduce((total, slide) => total + slide.estimated_seconds!, 0) <= duration ? slides : undefined;
  };
  const context: TPlanContext = {
    brief: bundle.confirmed_brief.summary.slice(0, 3600), intent: bundle.confirmed_brief.intent,
    audience: audience.slice(0, 600), speaking_seconds: duration, ...(pitch.slide_count && { slide_count: count }),
    headings: [...approved_headings.keys()].slice(0, 100),
    findings: findings.slice(0, 55).map(item => ({ ...item, text: item.text.slice(0, 480) })),
    talk_track: passages.map(({ id, purpose, narration, sentences }) => ({
      id, purpose, narration, evidence_ids: [...new Set(sentences.flatMap(sentence => sentence.evidence_ids))],
    })), evidence: context_records,
  };
  const propose = async (request: TPlanContext) => {
    try {
      const model_output = await plan(request, bundle.research_id);
      const planned = planner_output.safeParse(model_output);
      const proposed = planned.success ? build(planned.data.beats) : undefined;
      if (!proposed || !planned.success) {
        trace_plan(bundle.research_id, planned.success ? "rejected_constraints" :
          model_output === undefined ? "provider_unavailable" : "rejected_schema");
        return;
      }
      const review = await verify(proposed, bundle.evidence, bundle.research_id);
      const slides = verified_sequence(proposed, review);
      trace_plan(bundle.research_id, slides.length === proposed.length ? "accepted" :
        slides.length ? "accepted_verified_subset" : "rejected_verification");
      return { slides, rationale: planned.data.rationale +
        (slides.length < proposed.length ? " The deck retains the consecutive slides with checked content." : ""),
      feedback: typeof review === "object" ? review.feedback : [] };
    } catch {
      trace_plan(bundle.research_id, "proposal_failed");
      return;
    }
  };
  let selected = await propose(context);
  if (selected && !selected.slides.length && selected.feedback.length) {
    trace_plan(bundle.research_id, "repair_requested");
    selected = await propose({ ...context, review_feedback: selected.feedback.slice(0, 8) });
  }
  let slides = selected?.slides.length ? selected.slides : undefined;
  if (!slides) {
    const terms = new Set(audience.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []);
    const priority = (passage: TPassage) => {
      const text = ((passage.heading ?? "") + " " + passage.narration).toLowerCase();
      return [...terms].filter(term => text.includes(term)).length;
    };
    const eligible = passages.filter(passage => slide_speaking_seconds(passage.narration) <= duration);
    if (!saved_script) eligible.sort((left, right) => priority(right) - priority(left));
    const picked: TPassage[] = [];
    for (const passage of eligible) {
      const spoken = [...picked, passage].map(item => item.narration).join("\n\n");
      if (slide_speaking_seconds(spoken) <= duration) picked.push(passage);
    }
    if (!picked.length) throw new AppError(422, "No approved narration fits the requested time. Increase the duration.");
    const group_count = Math.min(count, picked.length);
    const groups = Array.from({ length: group_count }, (_, index) => picked.slice(
      Math.floor(index * picked.length / group_count), Math.floor((index + 1) * picked.length / group_count),
    ));
    if (groups.reduce((total, group) => total + slide_speaking_seconds(group.map(item => item.narration).join("\n\n")), 0) > duration) {
      groups.splice(0, groups.length, picked);
    }
    const used_titles = new Set<string>();
    slides = groups.map((group, index) => {
      const ids = [...new Set(group.flatMap(passage => passage.sentences.flatMap(sentence => sentence.evidence_ids)))];
      const visible = (ids.length ? ids : [...cited_records]).flatMap(id => excerpts(records.get(id)!.passage)
        .flatMap(text => short_text(110).safeParse(text).success ? [{ id, text }] : [])).slice(0, 2);
      const selected_heading = [...group.map(passage => passage.heading), bundle.findings.title].find(heading =>
        heading && !used_titles.has(heading.toLowerCase()) && short_text(72).safeParse(heading).success &&
        numeric_tokens(heading).every(value => (approved_headings.get(heading) ?? []).some(id =>
          numeric_tokens(records.get(id)!.passage).includes(value))));
      const title = selected_heading ?? "Verified finding " + (index + 1);
      used_titles.add(title.toLowerCase());
      const heading_ids = selected_heading ? approved_headings.get(selected_heading) ?? [] : [];
      return compile_beat({
        title, highlights: visible.length ? visible.map(item => item.text) : [saved_script ? "Approved talk track" : "Verified research context"],
        evidence_ids: [...new Set([...heading_ids, ...visible.map(item => item.id)])],
        template: { type: index === 0 ? "title_card" : "bullet_slide" },
      }, group.flatMap(passage => passage.sentences), group.map(passage => passage.narration).join("\n\n"), index, groups.length);
    });
  }
  const estimated_seconds = slides.reduce((total, slide) => total + slide.estimated_seconds!, pitch.demo?.seconds ?? 0);
  const rationale = (selected?.slides.length ? selected.rationale :
    (saved_script ? "The slides follow the saved, verified talk track and use short excerpts from its supporting sources." :
      "The slides use the saved, verified research findings as narration and quote their supporting sources.")) +
    (pitch.slide_count && slides.length < pitch.slide_count ? " There are fewer supported beats than the requested slide count." : "");
  return {
    deck_id: crypto.randomUUID(), research_id: bundle.research_id, revision: 1,
    title: bundle.findings.title, grounding_mode: "verified", slides,
    sources: deck_sources(bundle, new Set(slides.flatMap(slide => slide.evidence_ids))),
    pitch: { ...pitch, audience, rationale, estimated_seconds,
      ...(pitch.demo && { demo: { ...pitch.demo, after_slide_id: slides.at(-1)!.slide_id } }) },
  };
};
