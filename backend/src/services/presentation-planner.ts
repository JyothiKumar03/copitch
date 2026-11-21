import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { z } from "zod";
import { AppError } from "../errors/app-error";
import type { TModelCandidate } from "../types/ai";
import { MAX_PRESENTATION_SLIDES } from "../types/deck";
import type { TDeck, TDeckLayoutIssue, TDeckLayoutRepair, TDeckPlanInput, TDeckSentence, TPresentationReadiness, TSlide, TSlideTemplate } from "../types/deck";
import type { TEvidence, TResearchBundle, TResearchProvider } from "../types/research";
import { deck_sources, slide_speaking_seconds, slide_template_schema } from "./deck";
import { numeric_tokens, quotes } from "./excerpt";
import { configured_models_for } from "./model-config";
import { presentation_planner } from "./prompts";
import { verify_draft } from "./research-grounding";
import { research_provider } from "./research-provider";
import { saved_research_graphs, unit_supported } from "./research-graphs";

const sentences = new Intl.Segmenter(undefined, { granularity: "sentence" });
const internal_text = (text: string) => /^(?:\s*#+\s*)?(?:guardrails?|(?:system|developer) (?:message|prompt|instructions?)|speaker instructions?|(?:verification|formatting) instructions?)(?:\s*[:.\-–—]|\s*$)/imu.test(text) ||
  /\b(?:the host (?:asked|requested|wants|instructed)|the (?:presentation|presenter|slides?|narration|speaker|answer|output|agent|model) (?:must|should|needs? to))\b/iu.test(text) ||
  /^(?:use only|do not (?:invent|include|reveal|repeat|follow)|ignore (?:any|all|previous|the above)|(?:respond|output|return) (?:only|as|in)|(?:treat|cite) (?:the )?(?:supplied|approved|provided|evidence))\b/imu.test(text);
const speakable = (text: string) => !internal_text(text) && !/<\/?[a-z][\w:-]*(?:\s[^<>]*)?\s*\/?>/iu.test(text);
const short_text = (limit: number) => z.string().trim().min(1).max(limit)
  .refine(speakable);
const saved_graph_template = z.strictObject({ type: z.enum(["saved_graph"]), graph_id: z.string().min(1).max(16) });
const planned_beat = z.strictObject({
  title: short_text(72),
  highlights: z.array(short_text(110)).max(4),
  template: z.union([...slide_template_schema.options, saved_graph_template]),
  evidence_ids: z.array(z.string()).max(32),
  sentences: z.array(z.strictObject({ text: short_text(320), evidence_ids: z.array(z.string()).max(12) })).min(1).max(8),
});
const planner_output = z.strictObject({
  beats: z.array(planned_beat).min(1).max(MAX_PRESENTATION_SLIDES),
  rationale: short_text(600),
});
const readiness_schema = z.strictObject({
  status: z.enum(["ready", "limited", "insufficient"]),
  reason: short_text(300), gaps: z.array(short_text(180)).max(6),
});
const assessed_output = planner_output.extend({
  readiness: readiness_schema, beats: z.array(planned_beat).max(MAX_PRESENTATION_SLIDES),
});
type TAssessment = z.infer<typeof readiness_schema>;
type TParsedPlan = z.infer<typeof planner_output> & { readiness?: TAssessment };

type TPlanBeat = z.infer<typeof planned_beat>;
type TBeatVisual = Pick<TPlanBeat, "title" | "highlights" | "evidence_ids"> & Pick<TSlide, "template" | "chart_period">;
type TSavedGraph = ReturnType<typeof saved_research_graphs>[number];
type TPassage = { id: string; purpose: "opening" | "point" | "close"; narration: string; sentences: TDeckSentence[]; heading?: string };
type TPlanContext = {
  brief?: string;
  intent?: TResearchBundle["confirmed_brief"]["intent"];
  audience?: string;
  speaking_seconds?: number;
  slide_count?: number;
  headings: string[];
  findings: { heading: string; text: string; evidence_ids: string[] }[];
  talk_track?: { id: string; purpose: TPassage["purpose"]; narration: string; evidence_ids: string[] }[];
  evidence: Pick<TEvidence, "id" | "origin" | "passage" | "location">[];
  available_graphs?: TSavedGraph[];
  review_feedback?: string[];
  context_assessment?: { title: string; objective?: string; known_gaps: string[] };
  layout_repair?: {
    issues: TDeckLayoutIssue[];
    slides: Pick<TSlide, "slide_id" | "title" | "highlights" | "template" | "evidence_ids" | "chart_period">[];
  };
};
export type TPlanPresentation = (context: TPlanContext, research_id: string) => Promise<unknown>;
type TPresentationPlanReview = { verified_slide_ids: string[]; feedback: string[] };
export type TVerifyPresentationPlan = (slides: TSlide[], evidence: TEvidence[], research_id: string) =>
  Promise<boolean | TPresentationPlanReview>;


const literal_text = (passage: string, text: string) =>
  quotes(passage, text) && numeric_tokens(text).every(value => numeric_tokens(passage).includes(value));

const excerpts = (passage: string) => {
  const lines = passage.split("\n");
  return lines.flatMap((line, index) => [
    ...Array.from(sentences.segment(line), part => part.segment.trim()),
    ...(index > 0 ? [lines[index - 1] + "\n" + line] : []),
  ]).filter(text => !!text.trim());
};

// A plotted value is supported when a cited line states that exact number with its label close by. When several of a
// chart's points share one line (a sentence with two years and two figures), their labels and values must appear in the
// same order, so a swapped pairing is refused. A table row with several columns still qualifies.
const label_window = 200;
const number_pattern = /(?<![\d.,])[-+]?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?!\d|[.,]\d)/gu;
const label_terms = (label: string) => label.toLowerCase().split(" ").map(word => [...word]
  .filter(character => (character >= "a" && character <= "z") || (character >= "0" && character <= "9") || character === "-").join(""))
  .filter(word => word.length >= 3 || [...word].some(character => character >= "0" && character <= "9"));
// In a table the descriptive words sit in the header row and the period sits in the data row, so a label's dated terms
// must be on the value's line while its other words may appear anywhere in the same passage.
const has_digits = (term: string) => [...term].some(character => character >= "0" && character <= "9");
const label_positions = (line: string, label: string, passage = line) => {
  const lower = line.toLowerCase();
  const exact = lower.indexOf(label.toLowerCase());
  if (exact >= 0) return [{ at: exact, length: label.length }];
  const terms = label_terms(label);
  const dated = terms.filter(has_digits);
  const on_line = dated.length ? dated : terms;
  const whole = passage.toLowerCase();
  if (!terms.length || !on_line.every(term => lower.includes(term)) || !terms.every(term => whole.includes(term))) return [];
  const anchor = dated[0] ?? terms[0];
  const positions: { at: number; length: number }[] = [];
  for (let at = lower.indexOf(anchor); at >= 0; at = lower.indexOf(anchor, at + 1)) positions.push({ at, length: anchor.length });
  return positions;
};
type TPlacement = { line: string; label_at: number; value_at: number };
const uncertain_chart_value = /(?:[<>=~≈≤≥]\s*\d|\d\s*\+|\b(?:approximately|about|at least|more than|less than|fewer than|estimated|projections?|projected|forecasts?)\b)/iu;
const place = (passage: string, label: string, value: number, unit?: string): TPlacement[] => {
  const lines = passage.split("\n");
  const header_support = unit !== undefined && lines.some(row =>
    row.includes("|") && !numeric_tokens(row).length && unit_supported(unit, row));
  return lines.flatMap(line => {
    if (unit !== undefined && (uncertain_chart_value.test(line) ||
        (!unit_supported(unit, line) && !(line.includes("|") && header_support)))) return [];
    const labels = label_positions(line, label, passage);
    return [...line.matchAll(number_pattern)].flatMap(match => {
      if (Number(match[0].replaceAll(",", "")) !== value) return [];
      const value_at = match.index ?? 0;
      // A label digit can itself read as a number ("2023" in "2023-24"); only figures outside the label count.
      const near = labels.filter(({ at, length }) => Math.abs(at - value_at) <= label_window && !(value_at >= at && value_at < at + length))
        .map(({ at }) => at);
      return near.length ? [{ line, label_at: near.reduce((best, at) => Math.abs(at - value_at) < Math.abs(best - value_at) ? at : best), value_at }] : [];
    });
  });
};
const points_supported = (points: { label: string; value: number }[], records: TEvidence[], unit?: string) => {
  const placed = points.map(point => records.flatMap(record => place(record.passage, point.label, point.value, unit)));
  if (placed.some(options => !options.length)) return false;
  // Where several points share a line, the label order must match the value order.
  const lines = new Set(placed.flatMap(options => options.map(option => option.line)));
  for (const line of lines) {
    const shared = placed.map(options => options.find(option => option.line === line)).filter((option): option is TPlacement => !!option);
    if (shared.length < 2) continue;
    const by_label = [...shared].sort((left, right) => left.label_at - right.label_at);
    if (by_label.some((option, index) => index > 0 && option.value_at <= by_label[index - 1].value_at)) return false;
  }
  return true;
};

export const template_supported = (template: TSlideTemplate, records: TEvidence[]) => {
  const groups = records.flatMap(record => excerpts(record.passage));
  const together = (...parts: string[]) => groups.some(group =>
    group.length <= 320 && parts.every(part => literal_text(group, part)));
  const unique_numbers = (group: string, label: string, values: number[]) => {
    const other = numeric_tokens(group.replace(label, ""));
    return other.length > 0 && other.every(value => values.includes(value)) && values.every(value => other.includes(value));
  };
  const dated_value = (label: string, value: string) => numeric_tokens(value).length
    ? points_supported(numeric_tokens(value).map(number => ({ label, value: number })), records)
    : groups.some(group => group.length <= 320 && literal_text(group, label) && literal_text(group, value) && unique_numbers(group, label, numeric_tokens(value)));
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
        points_supported(template.points, records, template.unit);
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
    ...(beat.chart_period && { chart_period: beat.chart_period }),
    narration,
    sentences: script,
    evidence_ids: [...new Set([...beat.evidence_ids, ...script.flatMap(sentence => sentence.evidence_ids)])],
    estimated_seconds: slide_speaking_seconds(narration),
  };
};

const trace_plan = (research_id: string, outcome: string, counts?: { requested: number; generated: number; eligible: number; verified: number }) => {
  if (process.env.TRACE_LOGS === "1") console.log(JSON.stringify({ operation: "presentation.plan_acceptance", research_id, outcome, ...counts }));
};

export const presentation_plan_review = (provider: TResearchProvider): TVerifyPresentationPlan => async (slides, evidence, research_id) => {
  const call = provider.verify;
  const traced_provider: TResearchProvider = { ...provider, verify: call && ((review, signal) => call(review, signal, attempt => {
    if (process.env.TRACE_LOGS === "1") console.log(JSON.stringify({ operation: "presentation.plan_review", research_id, ...attempt }));
  })) };
  const records = new Map(evidence.map(record => [record.id, record]));
  const support = (ids: string[]) => ids.map(evidence_id => ({ evidence_id, excerpt: records.get(evidence_id)?.passage ?? "" }));
  const sections = slides.map(slide => ({ heading: slide.title, paragraphs: [
      ...(slide.highlights.length ? [{ prose: slide.highlights.join("\n"), support: support(slide.evidence_ids) }] : []),
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
      output: Output.object({ schema: context.context_assessment ? assessed_output : planner_output }), prompt: JSON.stringify(context),
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

// Every slide stands on its own, so each verified slide is kept even when a neighbour failed review.
const verified_slides = (slides: TSlide[], review: boolean | TPresentationPlanReview) => {
  if (typeof review === "boolean") return review ? slides : [];
  const verified = new Set(review.verified_slide_ids);
  const kept = slides.filter(slide => verified.has(slide.slide_id));
  if (kept.length === slides.length) return slides;
  return kept.map((slide, index): TSlide => ({ ...slide,
    layout: index === 0 ? "headline" : index === kept.length - 1 ? "takeaway" : "evidence" }));
};

const graph_visual = ({ graph }: TSavedGraph): { template: TSlideTemplate; chart_period?: string } => ({
  template: {
    type: graph.type === "bar" ? "bar_chart" : "line_chart",
    unit: graph.data[0].unit,
    points: graph.data.map(point => ({ label: graph.type === "bar" ? point.label : point.period, value: point.value })),
  },
  ...(graph.type === "bar" && { chart_period: graph.data[0].period }),
});

const chart_template_types: TSlideTemplate["type"][] = ["bar_chart", "line_chart", "donut_chart"];

const reuse_graphs = (slides: TSlide[], graphs: TSavedGraph[], maximum: number) => {
  const result = [...slides];
  const assigned = new Set<number>();
  for (const graph of graphs) {
    const source_ids = new Set(graph.graph.data.map(point => point.evidence_id));
    const ranked = result.flatMap((slide, index) => {
      if (assigned.has(index)) return [];
      const score = slide.evidence_ids.filter(id => source_ids.has(id)).length;
      return score ? [{ index, score }] : [];
    }).sort((left, right) => right.score - left.score);
    const match = ranked[0]?.index;
    if (match !== undefined) {
      const slide = result[match];
      result[match] = { ...slide, ...graph_visual(graph), evidence_ids: [...new Set([...slide.evidence_ids, ...graph.evidence_ids])] };
      assigned.add(match);
    } else if (result.length < maximum) {
      const narration = graph.graph.description;
      const index = result.length;
      const script = [{ sentence_id: `beat-${index + 1}-sentence-1`, text: narration, evidence_ids: graph.evidence_ids }];
      result.push(compile_beat({ title: graph.graph.name, highlights: [], evidence_ids: graph.evidence_ids,
        ...graph_visual(graph) }, script, narration, index, index + 1));
      assigned.add(index);
    }
  }
  return result;
};

export const plan_verified_pitch = async (bundle: TResearchBundle, pitch: TDeckPlanInput, plan: TPlanPresentation,
  verify: TVerifyPresentationPlan, layout_repair?: TDeckLayoutRepair): Promise<TDeck> => {
  const settings = "duration_minutes" in pitch ? pitch : undefined;
  if (layout_repair && (settings || layout_repair.deck.research_id !== bundle.research_id ||
      layout_repair.deck.grounding_mode !== "verified" || !layout_repair.issues.length)) {
    throw new AppError(422, "The layout report must refer to a verified deck for this research context.");
  }
  const graphs = settings ? [] : saved_research_graphs(bundle).filter(({ graph }) =>
    speakable(graph.name) && speakable(graph.description) && graph.data.every(point => speakable(point.label)));
  const by_graph_id = new Map(graphs.map(item => [item.graph_id, item]));
  const records = new Map(bundle.evidence.map(record => [record.id, record]));
  const cited_records = new Set<string>();
  const citations = new Map<string, Set<string>>();
  const supported_ids = (support: { evidence_id: string; excerpt: string }[]) => {
    if (!support.every(ref => quotes(records.get(ref.evidence_id)?.passage, ref.excerpt))) {
      throw new AppError(422, "The saved pitch has an unresolved evidence reference. Run research again before planning.");
    }
    const ids = [...new Set(support.map(ref => ref.evidence_id))];
    for (const id of ids) cited_records.add(id);
    for (const { evidence_id, excerpt } of support) {
      const approved = citations.get(evidence_id) ?? new Set<string>();
      if (speakable(excerpt)) approved.add(excerpt);
      citations.set(evidence_id, approved);
    }
    return ids;
  };
  const approved_headings = new Map<string, string[]>();
  const sections = bundle.findings.sections.flatMap(section => {
    if (!speakable(section.heading)) return [];
    const paragraphs = section.paragraphs.filter(paragraph => speakable(paragraph.prose) &&
      (settings || paragraph.support.length));
    return paragraphs.length ? [{ ...section, paragraphs }] : [];
  });
  const findings = sections.flatMap(section => {
    const result = section.paragraphs.map(paragraph => ({ heading: section.heading, text: paragraph.prose,
      evidence_ids: supported_ids(paragraph.support) }));
    approved_headings.set(section.heading, [...new Set(result.flatMap(item => item.evidence_ids))]);
    return result;
  });
  const deck_title = speakable(bundle.findings.title) ? bundle.findings.title : "Research presentation";
  approved_headings.set(deck_title, [...cited_records]);
  const saved_script = settings && bundle.pitch_script?.length ? bundle.pitch_script.filter(passage => speakable(passage.prose)) : undefined;
  const script_available = !!saved_script?.length;
  const narration_basis = script_available && saved_script
    ? saved_script.map(passage => ({ ...passage, heading: findings.find(item => item.evidence_ids.some(id =>
      passage.support.some(ref => ref.evidence_id === id)))?.heading }))
    : sections.flatMap(section => section.paragraphs
      .map(paragraph => ({ ...paragraph, purpose: "point" as const, heading: section.heading })));
  const passages = (settings ? narration_basis.slice(0, 55) : narration_basis).map((passage, index): TPassage => {
    const id = "passage-" + (index + 1);
    const evidence_ids = supported_ids(passage.support);
    return { id, purpose: passage.purpose, narration: passage.prose, heading: passage.heading,
      sentences: Array.from(sentences.segment(passage.prose), part => part.segment.trim()).filter(Boolean)
        .map((text, i) => ({ sentence_id: id + "-sentence-" + (i + 1), text, evidence_ids })),
    };
  });
  if ((!passages.length && !graphs.length) || passages.some(passage => !passage.sentences.length ||
      passage.purpose === "point" && !passage.sentences[0].evidence_ids.length)) {
    throw new AppError(422, "The saved pitch needs supported narration before it can be presented.");
  }
  const duration = settings ? settings.duration_minutes * 60 - (settings.demo?.seconds ?? 0) : Infinity;
  const count = Math.min(pitch.slide_count ?? MAX_PRESENTATION_SLIDES, MAX_PRESENTATION_SLIDES);
  const audience = settings ? settings.audience.trim() || bundle.confirmed_brief.intent?.audience || "Audience in the confirmed brief" : "";
  for (const { evidence_ids } of graphs) for (const id of evidence_ids) cited_records.add(id);
  const context_records: TPlanContext["evidence"] = [];
  let record_budget = 68_000;
  for (const id of cited_records) {
    const { origin, passage, location } = records.get(id)!;
    const excerpt = settings || speakable(passage) ? passage : [...(citations.get(id) ?? [])].join("\n");
    if (!excerpt) continue;
    const record = { id, origin, passage: excerpt, location };
    const size = Buffer.byteLength(JSON.stringify(record), "utf8");
    if (size > record_budget) continue;
    context_records.push(record);
    record_budget -= size;
  }
  // Each rejected rule is traced by name, so a refused plan says why instead of silently falling back.
  // A slide that breaks a rule is dropped with its reason traced; the rest of the plan survives. Dropping the whole
  // plan for one unsupported figure used to send the deck to the research-wording fallback.
  const reject = (reason: string) => { trace_plan(bundle.research_id, "rejected_constraints:" + reason); return undefined; };
  const skip = (reason: string) => trace_plan(bundle.research_id, "dropped_beat:" + reason);
  const build = (beats: TPlanBeat[]) => {
    if (!beats.length || beats.length > count) return reject("beat_count");
    const slides: TSlide[] = [];
    const titles = new Set<string>();
    const used_graphs = new Set<string>();
    const supported_numbers = (text: string, ids: string[]) => numeric_tokens(text).every(value =>
      ids.some(id => numeric_tokens(records.get(id)?.passage ?? "").includes(value)));
    for (const beat of beats) {
      const title_key = beat.title.toLowerCase();
      if (titles.has(title_key)) { skip("duplicate_title"); continue; }
      if (!beat.evidence_ids.length || !beat.evidence_ids.every(id => cited_records.has(id))) {
        skip("uncited_evidence");
        continue;
      }
      const used = beat.evidence_ids.map(id => records.get(id)!);
      const unsupported_visible = [beat.title, ...beat.highlights].find(text => !supported_numbers(text, beat.evidence_ids));
      if (unsupported_visible) { skip("unsupported_number_on_slide"); continue; }
      const unsupported_spoken = beat.sentences.find(sentence => !sentence.evidence_ids.every(id => cited_records.has(id)) ||
        !supported_numbers(sentence.text, sentence.evidence_ids));
      if (unsupported_spoken) { skip("unsupported_number_spoken"); continue; }
      let visual: TBeatVisual;
      if (beat.template.type === "saved_graph") {
        const saved = by_graph_id.get(beat.template.graph_id);
        if (!saved || used_graphs.has(saved.graph_id)) { skip("unknown_or_reused_graph"); continue; }
        used_graphs.add(saved.graph_id);
        visual = { ...beat, ...graph_visual(saved), evidence_ids: [...new Set([...beat.evidence_ids, ...saved.evidence_ids])] };
      } else {
        const supported = template_supported(beat.template, used);
        if (!supported) skip("template_downgraded:" + beat.template.type);
        const template = supported ? beat.template : { type: "bullet_slide" as const };
        if (!beat.highlights.length && !chart_template_types.includes(template.type)) { skip("empty_text_slide:" + beat.template.type); continue; }
        visual = { ...beat, template };
      }
      titles.add(title_key);
      const script = beat.sentences.flatMap(sentence => Array.from(sentences.segment(sentence.text), part => part.segment.trim())
        .filter(Boolean).map(text => ({ text, evidence_ids: [...new Set(sentence.evidence_ids)] })))
        .map((sentence, index) => ({ ...sentence, sentence_id: `beat-${slides.length + 1}-sentence-${index + 1}` }));
      slides.push(compile_beat(visual, script, script.map(sentence => sentence.text).join(" "), slides.length, beats.length));
    }
    if (!slides.length) return reject("no_usable_beats");
    const kept = slides.map((slide, index): TSlide => ({ ...slide,
      layout: index === 0 ? "headline" : index === slides.length - 1 ? "takeaway" : "evidence" }));
    return kept.reduce((total, slide) => total + slide.estimated_seconds!, 0) <= duration ? kept : reject("over_duration");
  };
  const context: TPlanContext = {
    ...(settings && {
      brief: bundle.confirmed_brief.summary.slice(0, 3600), intent: bundle.confirmed_brief.intent,
      audience: audience.slice(0, 600), speaking_seconds: duration,
      talk_track: passages.map(({ id, purpose, narration, sentences }) => ({
        id, purpose, narration, evidence_ids: [...new Set(sentences.flatMap(sentence => sentence.evidence_ids))],
      })),
    }),
    ...(pitch.slide_count && { slide_count: count }),
    ...(graphs.length && { available_graphs: graphs }),
    headings: [...approved_headings.keys()].slice(0, 100),
    findings: settings ? findings.slice(0, 55).map(item => ({ ...item, text: item.text.slice(0, 480) })) : findings,
    ...(!settings && { context_assessment: {
      title: deck_title,
      ...(bundle.confirmed_brief.intent?.outcome && speakable(bundle.confirmed_brief.intent.outcome) &&
        { objective: bundle.confirmed_brief.intent.outcome }),
      known_gaps: bundle.gaps.filter(gap => speakable(gap)).slice(0, 30).map(gap => gap.slice(0, 500)),
    } }),
    ...(layout_repair && { layout_repair: {
      slides: layout_repair.deck.slides.map(({ slide_id, title, highlights, template, evidence_ids, chart_period }) =>
        ({ slide_id, title, highlights, template, evidence_ids, chart_period })),
      issues: layout_repair.issues.filter(item => layout_repair.deck.slides.some(slide => slide.slide_id === item.slide_id))
        .slice(0, 24).map(item => ({ ...item, viewport: item.viewport?.slice(0, 64), note: item.note?.slice(0, 240) })),
    } }),
    evidence: context_records,
  };
  if (context.layout_repair && !context.layout_repair.issues.length) throw new AppError(422, "The layout report needs valid slide IDs.");
  let assessment: TAssessment | undefined;
  const propose = async (request: TPlanContext) => {
    try {
      const model_output = await plan(request, bundle.research_id);
      const planned: z.ZodSafeParseResult<TParsedPlan> = (settings ? planner_output : assessed_output).safeParse(model_output);
      if (planned.success && planned.data.readiness) {
        assessment = planned.data.readiness;
        if (assessment.status === "insufficient") return;
      }
      const proposed = planned.success ? build(planned.data.beats) : undefined;
      if (!proposed || !planned.success) {
        trace_plan(bundle.research_id, planned.success ? "rejected_constraints" :
          model_output === undefined ? "provider_unavailable" : "rejected_schema");
        return;
      }
      const review = await verify(proposed, bundle.evidence, bundle.research_id);
      const slides = verified_slides(proposed, review);
      if (layout_repair && slides.length !== layout_repair.deck.slides.length) {
        trace_plan(bundle.research_id, "layout_candidate_lost_verified_slides");
        return;
      }
      trace_plan(bundle.research_id, slides.length === proposed.length ? "accepted" :
        slides.length ? "accepted_verified_subset" : "rejected_verification",
        { requested: count, generated: planned.data.beats.length, eligible: proposed.length, verified: slides.length });
      return { slides, assessment, generated_count: planned.data.beats.length, rationale: planned.data.rationale +
        (slides.length < proposed.length ? " The deck retains the slides with checked content." : ""),
      feedback: typeof review === "object" ? review.feedback : [] };
    } catch {
      trace_plan(bundle.research_id, "proposal_failed");
      return;
    }
  };
  const require_sufficient_context = () => {
    if (assessment?.status === "insufficient") throw new AppError(422, [assessment.reason, ...assessment.gaps].join(" "));
  };
  let selected = await propose(context);
  require_sufficient_context();
  const verified_count = selected?.slides.length ?? 0;
  const source_backed_count = Math.min(count, passages.length);
  const needs_count_repair = !settings && verified_count < count &&
    (!selected || selected.assessment?.status !== "limited" || selected.generated_count > verified_count || source_backed_count > verified_count);
  if (!layout_repair && (needs_count_repair || (selected && !verified_count && selected.feedback.length))) {
    trace_plan(bundle.research_id, "repair_requested");
    const count_feedback = needs_count_repair ? [
      `The first plan retained ${verified_count} of ${count} requested slides. Use the full saved findings to reach ${count} distinct slides wherever supported. A finding may support multiple independent takeaways. Retain qualifications and use a simple text slide when the evidence does not bind a visual precisely. Explain any genuine shortfall.`,
    ] : [];
    const repaired = await propose({ ...context, review_feedback: [...count_feedback, ...(selected?.feedback ?? [])].slice(0, 8) });
    if (!verified_count) require_sufficient_context();
    if (repaired && repaired.slides.length >= verified_count) selected = repaired;
  }
  const selected_plan = selected && selected.slides.length && (settings || layout_repair || selected.slides.length >= source_backed_count)
    ? selected : undefined;
  let slides = selected_plan?.slides;
  if (layout_repair && !slides) throw new AppError(422, "The layout repair did not produce a verified candidate. Keep the previous draft.");
  if (slides) {
    if (!slides.some(slide => slide.chart || slide.template && chart_template_types.includes(slide.template.type))) {
      slides = reuse_graphs(slides, graphs, slides.length);
    }
  } else {
    const terms = new Set(audience.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []);
    const priority = (passage: TPassage) => {
      const text = ((passage.heading ?? "") + " " + passage.narration).toLowerCase();
      return [...terms].filter(term => text.includes(term)).length;
    };
    const eligible = passages.filter(passage => slide_speaking_seconds(passage.narration) <= duration);
    if (settings && !script_available) eligible.sort((left, right) => priority(right) - priority(left));
    const picked: TPassage[] = [];
    for (const passage of eligible) {
      const spoken = [...picked, passage].map(item => item.narration).join("\n\n");
      if (slide_speaking_seconds(spoken) <= duration) picked.push(passage);
    }
    if (!picked.length && !graphs.length) throw new AppError(422, "No approved narration fits the requested time. Increase the duration.");
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
      const candidates = settings ? (ids.length ? ids : [...cited_records]).flatMap(id => excerpts(records.get(id)!.passage)
        .map(text => ({ text, evidence_ids: [id] }))) : group.flatMap(passage => passage.sentences);
      const visible = candidates.filter(item => short_text(110).safeParse(item.text).success).slice(0, 2);
      const selected_heading = [...group.map(passage => passage.heading), deck_title].find(heading =>
        heading && !used_titles.has(heading.toLowerCase()) && short_text(72).safeParse(heading).success &&
        numeric_tokens(heading).every(value => (approved_headings.get(heading) ?? []).some(id =>
          numeric_tokens(records.get(id)!.passage).includes(value))));
      const title = selected_heading ?? "Verified finding " + (index + 1);
      used_titles.add(title.toLowerCase());
      const heading_ids = selected_heading ? approved_headings.get(selected_heading) ?? [] : [];
      return compile_beat({
        title, highlights: visible.length ? visible.map(item => item.text) : [script_available ? "Approved talk track" : "Research findings"],
        evidence_ids: [...new Set([...heading_ids, ...visible.flatMap(item => item.evidence_ids)])],
        template: { type: index === 0 ? "title_card" : "bullet_slide" },
      }, group.flatMap(passage => passage.sentences), group.map(passage => passage.narration).join("\n\n"), index, groups.length);
    });
    slides = reuse_graphs(slides, graphs, count).map((slide, index, fallback_slides) => ({ ...slide,
      layout: index === 0 ? "headline" : index === fallback_slides.length - 1 ? "takeaway" : "evidence" }));
  }
  const estimated_seconds = slides.reduce((total, slide) => total + slide.estimated_seconds!, settings?.demo?.seconds ?? 0);
  const rationale = (selected_plan ? selected_plan.rationale :
    (script_available ? "The slides follow the saved, verified talk track and use short excerpts from its supporting sources." :
      "The slides follow the saved, verified research findings.")) +
    (pitch.slide_count && slides.length < pitch.slide_count
      ? ` This draft has ${slides.length} of ${pitch.slide_count} requested slides because fewer distinct beats passed the checks.` : "");
  const model_assessment = selected_plan?.assessment;
  const recovered_coverage = !selected_plan && !!selected?.slides.length;
  const limited = slides.length < count || model_assessment?.status === "limited";
  const readiness: TPresentationReadiness | undefined = settings ? undefined : {
    status: limited ? "limited" : "ready",
    basis: model_assessment ? "model" : "verified_findings",
    reason: model_assessment?.reason ?? (recovered_coverage
      ? "Some rewritten slides did not pass fact-checking. This draft uses the saved verified findings."
      : limited ? "The saved findings support a shorter presentation." : "The saved findings support the requested slides."),
    gaps: model_assessment?.gaps ?? [],
  };
  return {
    deck_id: crypto.randomUUID(), research_id: bundle.research_id, revision: 1,
    title: deck_title, grounding_mode: "verified", slides,
    sources: deck_sources(bundle, new Set(slides.flatMap(slide => slide.evidence_ids))),
    pitch: { ...pitch, audience, rationale, estimated_seconds,
      duration_minutes: settings?.duration_minutes ?? Math.max(1, Math.ceil(estimated_seconds / 60)),
      ...(readiness && { readiness }),
      ...(settings?.demo && { demo: { ...settings.demo, after_slide_id: slides.at(-1)!.slide_id } }) },
  };
};
