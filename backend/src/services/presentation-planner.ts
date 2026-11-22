import { metered_model } from "./mission-metering";
import { is_non_omission } from "./slide-content";
import { log_failure } from "../middleware/trace";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, JSONParseError, NoObjectGeneratedError, Output, TypeValidationError } from "ai";
import type { FinishReason, LanguageModelUsage } from "ai";
import { z } from "zod";
import { AppError } from "../errors/app-error";
import { DeckPreparationError } from "./deck-preparation-failure";
import type { TModelCandidate } from "../types/ai";
import { MAX_PRESENTATION_SLIDES } from "../types/deck";
import type { TDeck, TDeckLayoutIssue, TDeckLayoutRepair, TDeckPlanInput, TDeckSentence, TPresentationReadiness, TSlide, TSlideTemplate } from "../types/deck";
import type { TEvidence, TGroundingCoverageBrief, TGroundingOmission, TResearchBundle, TResearchProvider } from "../types/research";
import { deck_sources, slide_speaking_seconds, slide_template_schema } from "./deck";
import { numeric_tokens, quotes } from "./excerpt";
import { configured_models_for, MAX_SLIDE_PLAN_OUTPUT_TOKENS } from "./model-config";
import { presentation_planner } from "./prompts";
import { verify_draft } from "./research-grounding";
import { research_provider } from "./research-provider";
import { saved_research_graphs, unit_supported } from "./research-graphs";
import { contains_draft_instruction, is_draft_instruction } from "./slide-content";

const sentences = new Intl.Segmenter(undefined, { granularity: "sentence" });
const internal_text = (text: string) => /^(?:\s*#+\s*)?(?:guardrails?|(?:system|developer) (?:message|prompt|instructions?)|speaker instructions?|(?:verification|formatting) instructions?)(?:\s*[:.\-–—]|\s*$)/imu.test(text) ||
  /\b(?:the host (?:asked|requested|wants|instructed)|the (?:presentation|presenter|deck|slides?|narration|speaker|answer|output|agent|model) (?:must|should|needs? to))\b/iu.test(text) ||
  /^(?:use only|do not (?:invent|include|reveal|repeat|follow)|ignore (?:any|all|previous|the above)|(?:respond|output|return) (?:only|as|in)|(?:treat|cite) (?:the )?(?:supplied|approved|provided|evidence))\b/imu.test(text);
// A highlight is on-screen content for the audience. A subjectless note about what the slide does
// ("Introduces the host by name", "Sets the tone for…") is the planner describing its own design.
const slide_commentary = (text: string) =>
  /^(?:(?:a strong|a memorable) (?:slide|opening|closing)|introduces|sets|adds|shows|highlights|gives|keeps|connects|signals|summari[sz]es|closes|leaves|focuses|frames|establishes|opens|wraps|reinforces|positions|explains|demonstrates|emphasi[sz]es|illustrates|previews|recaps|transitions|invites|ends)\b/iu.test(text.trim()) &&
  !/\d/u.test(text);
const title_words = (text: string) => text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}\p{M}]+/gu)?.join(" ") ?? "";
export const without_commentary = (beat: TPlanBeat): TPlanBeat => {
  const content = beat.highlights.filter(text => !slide_commentary(text) && !is_draft_instruction(text));
  const spoken_facts = beat.sentences.filter(sentence => !is_draft_instruction(sentence.text));
  if (beat.template.type === "title_card") {
    const title = ` ${title_words(beat.title)} `;
    return { ...beat, sentences: spoken_facts, highlights: content.filter(text => {
      const phrase = title_words(text);
      return phrase && !title.includes(` ${phrase} `);
    }) };
  }
  if (content.length === beat.highlights.length) return { ...beat, sentences: spoken_facts };
  // If the bullets were commentary, use the beat's own spoken facts for a text slide.
  const spoken = content.length ? [] : spoken_facts.filter(sentence => sentence.evidence_ids.length).map(sentence => sentence.text.trim())
    .filter(text => text.length <= 110 && !slide_commentary(text)).slice(0, 3);
  return { ...beat, highlights: [...content, ...spoken], sentences: spoken_facts };
};
const speakable = (text: string) => !internal_text(text) && !/<\/?[a-z][\w:-]*(?:\s[^<>]*)?\s*\/?>/iu.test(text);
const audience_text = (text: string) => speakable(text) && !is_draft_instruction(text);
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
const objective_finding_schema = z.strictObject({
  finding: short_text(240), evidence_ids: z.array(z.string()).min(1).max(12),
});
const assessed_output = planner_output.extend({
  readiness: readiness_schema, beats: z.array(planned_beat).max(MAX_PRESENTATION_SLIDES),
  objective_findings: z.array(objective_finding_schema).max(8).optional(),
});
const assessed_provider_output = assessed_output.required({ objective_findings: true });
const completion_output = assessed_output.omit({ beats: true, objective_findings: true }).extend({
  additions: z.array(z.strictObject({ after_slide_id: z.string().max(32).nullable(), beat: planned_beat }))
    .max(MAX_PRESENTATION_SLIDES),
});
type TAssessment = z.infer<typeof readiness_schema>;
type TObjectiveFinding = z.infer<typeof objective_finding_schema>;

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
  evidence: TPresentationEvidence[];
  available_graphs?: TSavedGraph[];
  review_feedback?: string[];
  verified_beats?: TPlanBeat[];
  objective_findings?: TObjectiveFinding[];
  completion?: { missing: number; candidate_limit: number; retained: { slide_id: string; beat: TPlanBeat }[] };
  context_assessment?: { title: string; objective?: string; audience?: string; known_gaps: string[] };
  layout_repair?: {
    issues: TDeckLayoutIssue[];
    slides: Pick<TSlide, "slide_id" | "title" | "highlights" | "template" | "evidence_ids" | "chart_period">[];
  };
};
export type TPlanPresentation = (context: TPlanContext, research_id: string, signal?: AbortSignal) => Promise<unknown>;
type TPresentationPlanReview = { verified_slide_ids: string[]; feedback: string[]; unavailable?: boolean;
  omissions?: TObjectiveFinding[]; revised_narration?: Record<string, string[]> };
type TPlanReviewOptions = { coverage_brief?: TGroundingCoverageBrief; visible_evidence: ReadonlyMap<string, string[]> };
type TPlanAttempt = {
  slides: TSlide[];
  verified_beats: TPlanBeat[];
  feedback: string[];
  objectives: TObjectiveFinding[];
  rationale?: string;
  assessment?: TAssessment;
  unavailable?: boolean;
  output_rejected?: boolean;
  anchors?: Map<string, string | null>;
};
export type TVerifyPresentationPlan = (slides: TSlide[], evidence: TEvidence[], research_id: string, signal?: AbortSignal,
  options?: TPlanReviewOptions) => Promise<boolean | TPresentationPlanReview>;

export class PresentationCoverageError extends DeckPreparationError {
  constructor(readonly requested: number, readonly verified: number, gaps: string[], partial: TSlide[] = []) {
    super("insufficient_evidence", [`${verified} of ${requested} requested slides passed review.`,
      `Add evidence for the remaining slides or choose a smaller deck.`, ...gaps.slice(0, 2)].join(" "), gaps, partial);
    this.name = "PresentationCoverageError";
  }
}

type TPresentationEvidence = Pick<TEvidence, "id" | "origin" | "passage" | "location" | "url">;
const presentation_evidence_budget = 68_000;

// Host statements the approved brief requires. Research rarely cites a personal fact, so the planner must see and cover it anyway.
const required_host_note = (bundle: TResearchBundle) => {
  const notes = (bundle.confirmed_brief.studio_notes ?? []).filter(note => speakable(note));
  return (passage: string) => notes.some(note => quotes(passage, note) || quotes(note, passage));
};

export const select_presentation_evidence = (bundle: TResearchBundle): TPresentationEvidence[] => {
  const excerpts_by_id = new Map<string, Set<string>>();
  const by_id = new Map(bundle.evidence.map(record => [record.id, record]));
  for (const section of bundle.findings.sections) {
    if (!speakable(section.heading)) continue;
    for (const paragraph of section.paragraphs) {
      if (!speakable(paragraph.prose)) continue;
      for (const { evidence_id, excerpt } of paragraph.support) {
        if (!speakable(excerpt) || !quotes(by_id.get(evidence_id)?.passage, excerpt)) continue;
        const excerpts = excerpts_by_id.get(evidence_id) ?? new Set<string>();
        excerpts.add(excerpt);
        excerpts_by_id.set(evidence_id, excerpts);
      }
    }
  }
  const graph_ids = new Set(saved_research_graphs(bundle).flatMap(graph => graph.evidence_ids));
  const required = required_host_note(bundle);
  const required_ids = new Set(bundle.evidence.filter(({ origin, passage }) => origin === "host" && required(passage)).map(({ id }) => id));
  const linked = (id: string) => excerpts_by_id.has(id) || graph_ids.has(id) || required_ids.has(id);
  const ordered = [...bundle.evidence].sort((left, right) => Number(linked(right.id)) - Number(linked(left.id)));
  let remaining = presentation_evidence_budget;
  return ordered.flatMap(({ id, origin, location, url, passage }) => {
    if (origin === "host" && !excerpts_by_id.has(id) && !required_ids.has(id)) return [];
    if (origin === "public" && bundle.confirmed_brief.source_policy === "files_only") return [];
    const supported_excerpt = [...(excerpts_by_id.get(id) ?? [])].join("\n\n");
    const eligible_passage = (origin !== "host" || required_ids.has(id)) && speakable(passage) ? passage : supported_excerpt;
    for (const candidate of new Set([eligible_passage, supported_excerpt])) {
      if (!candidate.trim()) continue;
      const record = { id, origin, location, url, passage: candidate };
      const size = Buffer.byteLength(JSON.stringify(record), "utf8") + 1;
      if (size > remaining) continue;
      remaining -= size;
      return [record];
    }
    return [];
  });
};

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
  // PDF prose commonly wraps within a sentence. Join only prose runs; table rows must stay separate.
  const prose = passage.split(/\n\s*\n|^.*\|.*$/mu).flatMap(run =>
    Array.from(sentences.segment(run.replace(/\s*\n\s*/gu, " ")), part => part.segment.trim()));
  return [...new Set([...lines, ...prose])].flatMap(line => {
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

const donut_supported = (template: Extract<TSlideTemplate, { points: unknown[] }>) => {
  const values = template.points.map(point => point.value);
  if (values.some(value => value < 0) || values.filter(value => value > 0).length < 2) return false;
  if (/^(?:%|percent|per cent|percentage)$/iu.test(template.unit)) {
    // Independently reported shares can differ slightly from 100 because they were rounded.
    return Math.abs(values.reduce((sum, value) => sum + value, 0) - 100) <= 1;
  }
  return !/^(?:%|percentage|percent|per cent)\s*(?:points?|pts?)$/iu.test(template.unit);
};

export const template_supported = (template: TSlideTemplate, records: TEvidence[]) => {
  if (contains_draft_instruction(template)) return false;
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
        (template.type !== "donut_chart" || donut_supported(template)) &&
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

const trace_plan = (research_id: string, outcome: string,
  counts?: { requested?: number; generated?: number; eligible?: number; verified?: number; missing?: string[]; feedback?: string[] }) => {
  if (process.env.TRACE_LOGS === "1") console.log(JSON.stringify({ operation: "presentation.plan_acceptance", research_id, outcome, ...counts }));
};

const bounded_signal = (milliseconds: number, parent?: AbortSignal) => {
  const deadline = AbortSignal.timeout(milliseconds);
  return parent ? AbortSignal.any([parent, deadline]) : deadline;
};

const objective_planning_instructions = `
For a count-only deck, map the explicit presentation objective to objective_findings before drafting beats. Include each requested part that the passages can answer. Each entry is a short factual statement that would answer that part, with any requested figures in the source's own units and the minimum original evidence IDs needed to support it. Keep a requested comparison together with both measures. Do not list an opening, incidental context, or repeated measures as separate requirements. If objective_findings is supplied in the input, preserve it. For completion with unmet objective_findings, write the missing requested findings before considering any alternative. Use one complete, fully cited factual sentence per such addition, even when a regular slide would have more. Say the finding's exact figures, units and qualifications together. Keep the narration to the measured finding. Do not add an interpretation, evaluation, transition or repeated opener. An opening that repeats part of a comparison does not count as a separate takeaway.`;

export const presentation_plan_review = (provider: TResearchProvider): TVerifyPresentationPlan => async (slides, evidence, research_id, signal, options) => {
  const call = provider.verify;
  const coverage_brief = options?.coverage_brief;
  let omissions: TGroundingOmission[] | undefined;
  const traced_provider: TResearchProvider = { ...provider, verify: call && (async (review, signal) => {
    const result = await call({ ...review, ...(coverage_brief && { purpose: "deck_presentation" as const }) }, signal, attempt => {
      if (process.env.TRACE_LOGS === "1") console.log(JSON.stringify({ operation: "presentation.plan_review", research_id, ...attempt }));
    });
    omissions = review.coverage && !Array.isArray(result) ? result.omissions : undefined;
    return result;
  }) };
  const records = new Map(evidence.map(record => [record.id, record]));
  const support = (ids: string[]) => ids.map(evidence_id => ({ evidence_id, excerpt: records.get(evidence_id)?.passage ?? "" }));
  const sections = slides.map(slide => {
    const visible_support = support(options?.visible_evidence.get(slide.slide_id) ?? slide.evidence_ids);
    return { heading: slide.title, paragraphs: [
      ...(slide.highlights.length ? [{ prose: slide.highlights.join("\n"), support: visible_support }] : []),
      ...(slide.template && !["title_card", "bullet_slide"].includes(slide.template.type)
        ? [{ prose: JSON.stringify(slide.template), support: visible_support }] : []),
      ...(slide.sentences ?? []).map(sentence => ({ prose: sentence.text, support: support(sentence.evidence_ids) })),
    ] };
  });
  const result = await verify_draft({ title: "Presentation review", gaps: [], sections },
    evidence, [], traced_provider, bounded_signal(20_000, signal), undefined,
    () => trace_plan(research_id, "independent_check_unavailable"), coverage_brief);
  signal?.throwIfAborted();
  const revised_narration = new Map<string, string[]>();
  const supported = (id: string) => result.decisions?.get(id) === "supported";
  const verified_slide_ids = slides.filter((slide, index) => {
    const spoken = slide.sentences ?? [];
    const first_sentence = sections[index].paragraphs.length - spoken.length;
    const approved_paragraphs = sections[index].paragraphs.map((_, part) => supported(`paragraph-${index}-${part}`));
    if (!supported(`section-${index}`) || !approved_paragraphs.slice(0, first_sentence).every(Boolean)) return false;
    if (approved_paragraphs.every(Boolean)) return true;
    if (!options) return false;
    const kept = spoken.filter((_, part) => approved_paragraphs[first_sentence + part]);
    if (!kept.some(sentence => sentence.evidence_ids.length > 0)) return false;
    revised_narration.set(slide.slide_id, kept.map(sentence => sentence.sentence_id));
    return true;
  }).map(slide => slide.slide_id);
  if (revised_narration.size) trace_plan(research_id, "trimmed_unverified_narration");
  trace_plan(research_id, verified_slide_ids.length === slides.length ? "independently_verified" :
    verified_slide_ids.length ? "independent_check_partial" : "independent_check_rejected");
  const missing = result.coverage_feedback?.length && Array.isArray(omissions) ? omissions.flatMap(omission => {
    if (!omission.objective_excerpt || !coverage_brief?.intent?.outcome.includes(omission.objective_excerpt)) return [];
    if (is_non_omission(omission.finding ?? "")) return [];
    const parsed = objective_finding_schema.safeParse({ finding: omission?.finding, evidence_ids: omission?.evidence_ids });
    return parsed.success ? [parsed.data] : [];
  }).slice(0, 8) : [];
  return { verified_slide_ids, feedback: result.feedback ?? [], ...(missing.length && { omissions: missing }),
    ...(revised_narration.size && { revised_narration: Object.fromEntries(revised_narration) }),
    ...(!result.decisions && { unavailable: true }) };
};

export const verify_presentation_plan: TVerifyPresentationPlan = async (slides, evidence, research_id, signal, options) => {
  const [model] = configured_models_for("planning");
  return model && process.env.OPENAI_API_KEY
    ? presentation_plan_review(research_provider(model, undefined, []))(slides, evidence, research_id, signal, options)
    : { verified_slide_ids: [], feedback: [], unavailable: true };
};

type TPlanSchemaIssue = { path: string; code: string; limit?: number; unit?: "characters" | "items" };
const plan_schema_issues = (error: NoObjectGeneratedError): TPlanSchemaIssue[] => {
  const failure = error.cause;
  if (!TypeValidationError.isInstance(failure) || !(failure.cause instanceof z.ZodError)) return [];
  // Paths come from the declared object and array schemas. Values, messages, and extra keys may contain draft content.
  return failure.cause.issues.slice(0, 6).map(issue => {
    const path = issue.path.every(part => typeof part === "number" || typeof part === "string" && /^[a-z][a-z0-9_]*$/u.test(part))
      ? issue.path.join(".") || "response" : "response";
    const limit = issue.code === "too_big" ? issue.maximum : issue.code === "too_small" ? issue.minimum : undefined;
    const unit = "origin" in issue && issue.origin === "string" ? "characters" : "items";
    return { path, code: issue.code, ...(typeof limit === "number" && { limit, unit }) };
  });
};

const can_repair_plan_output = (error: unknown): error is NoObjectGeneratedError => NoObjectGeneratedError.isInstance(error) &&
  (error.finishReason === "length" || error.finishReason === "stop" &&
    (TypeValidationError.isInstance(error.cause) || JSONParseError.isInstance(error.cause)));

const plan_output_feedback = (error: NoObjectGeneratedError): string[] => {
  if (error.finishReason === "length") return [
    "The response reached the output limit. Keep the requested slide or addition count. Use at most two short highlights and one complete, cited narration sentence per slide. Keep the rationale brief and finish the JSON object.",
  ];
  const issues = plan_schema_issues(error);
  if (!issues.length) return ["Return a complete JSON object matching every required field of the supplied schema."];
  return issues.map(({ path, code, limit, unit }) => {
    const correction = limit !== undefined ? `use ${code === "too_big" ? "at most" : "at least"} ${limit} ${unit}` :
      code === "custom" ? "use plain audience-facing content without markup or instructions" :
        code === "unrecognized_keys" ? "remove fields outside the declared schema" : "use the declared field type and allowed values";
    return `Correct ${path} (${code}): ${correction}.`;
  });
};

export const presentation_plan_provider = (config: TModelCandidate, openai = createOpenAI()): TPlanPresentation => async (context, research_id, signal) => {
  const started = performance.now();
  const max_output_tokens = Math.min(config.max_output_tokens, MAX_SLIDE_PLAN_OUTPUT_TOKENS);
  let outcome = "failed";
  let usage: LanguageModelUsage | undefined;
  let finish_reason: FinishReason | undefined;
  let output_error: NoObjectGeneratedError | undefined;
  try {
    const reply = await generateText({
      model: metered_model(config, openai.responses(config.model)), maxOutputTokens: max_output_tokens,
      temperature: config.temperature, maxRetries: 0, abortSignal: bounded_signal(25_000, signal),
      providerOptions: { openai: { store: false } }, instructions: context.context_assessment
        ? presentation_planner + objective_planning_instructions : presentation_planner,
      output: Output.object({ schema: context.completion ? completion_output :
        context.context_assessment ? assessed_provider_output : planner_output }), prompt: JSON.stringify(context),
    });
    usage = reply.usage;
    finish_reason = reply.finishReason;
    const output = reply.output;
    outcome = "completed";
    return output;
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      output_error = error;
      usage = error.usage ?? usage;
      finish_reason = error.finishReason ?? finish_reason;
    }
    throw error;
  } finally {
    const trace = { operation: "presentation.plan", research_id, model: config.model, outcome, finish_reason, max_output_tokens,
      usage: usage && { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
        reasoningTokens: usage.outputTokenDetails?.reasoningTokens }, duration_ms: Math.round(performance.now() - started) };
    if (output_error) console.error(JSON.stringify({ ...trace, level: "error", error: output_error.name,
      schema_issues: plan_schema_issues(output_error) }));
    else if (process.env.TRACE_LOGS === "1") console.log(JSON.stringify(trace));
  }
};

export const request_presentation_plan: TPlanPresentation = async (context, research_id, signal) => {
  const [config] = configured_models_for("planning");
  if (config && process.env.OPENAI_API_KEY) return presentation_plan_provider(config)(context, research_id, signal);
};

const slide_layouts = (slides: TSlide[]): TSlide[] => slides.map((slide, index) => ({ ...slide,
  layout: index === 0 ? "headline" : index === slides.length - 1 ? "takeaway" : "evidence",
}));

// Every slide stands on its own, so each verified slide is kept even when a neighbour failed review.
const verified_slides = (slides: TSlide[], review: boolean | TPresentationPlanReview, visible_evidence: ReadonlyMap<string, string[]>) => {
  if (typeof review === "boolean") return review ? slides : [];
  const verified = new Set(review.verified_slide_ids);
  const kept = slides.filter(slide => verified.has(slide.slide_id)).map(slide => {
    const retained = review.revised_narration?.[slide.slide_id];
    if (!retained) return slide;
    const sentences = slide.sentences?.filter(sentence => retained.includes(sentence.sentence_id)) ?? [];
    const narration = sentences.map(sentence => sentence.text).join(" ");
    const evidence_ids = [...new Set([...(visible_evidence.get(slide.slide_id) ?? []), ...sentences.flatMap(sentence => sentence.evidence_ids)])];
    return { ...slide, sentences, narration, evidence_ids, estimated_seconds: slide_speaking_seconds(narration) };
  });
  return kept.length === slides.length ? kept : slide_layouts(kept);
};

const covered_objectives = (slide: TSlide, objectives: TObjectiveFinding[]) => {
  const facts = numeric_tokens([slide.title, ...slide.highlights, slide.narration,
    slide.chart_period, slide.template ? JSON.stringify(slide.template) : undefined].join(" "));
  return objectives.filter(({ finding, evidence_ids }) => evidence_ids.every(id => slide.evidence_ids.includes(id)) &&
    numeric_tokens(finding).every(value => facts.includes(value)));
};

const uncovered_objectives = (slides: TSlide[], objectives: TObjectiveFinding[]) => {
  const covered = new Set(slides.flatMap(slide => covered_objectives(slide, objectives)));
  return objectives.filter(finding => !covered.has(finding));
};

const select_verified_slides = (verified: TSlide[], maximum: number, objectives: TObjectiveFinding[], preferences: TObjectiveFinding[]) => {
  const selected = new Set<TSlide>();
  let remaining = objectives;
  const prioritize = (findings: TObjectiveFinding[], limit: number) => {
    const candidates = verified.map(slide => ({ slide, covers: covered_objectives(slide, findings) }));
    while (findings.length && selected.size < limit) {
      const next = candidates.filter(({ slide }) => !selected.has(slide))
        .map(({ slide, covers }) => ({ slide, new_findings: covers.filter(finding => findings.includes(finding)) }))
        .sort((left, right) => right.new_findings.length - left.new_findings.length).find(item => item.new_findings.length);
      if (!next) break;
      selected.add(next.slide);
      findings = findings.filter(finding => !next.new_findings.includes(finding));
    }
    return findings;
  };
  remaining = prioritize(remaining, maximum);
  const limit = maximum - remaining.length;
  prioritize(uncovered_objectives([...selected], preferences), limit);
  // Keep room for uncovered parts of the objective before adding optional slides.
  for (const slide of verified) {
    if (selected.size >= limit) break;
    selected.add(slide);
  }
  return slide_layouts(verified.filter(slide => selected.has(slide)));
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
const max_completion_rounds = 3;

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
  verify: TVerifyPresentationPlan, layout_repair?: TDeckLayoutRepair, signal?: AbortSignal): Promise<TDeck> => {
  const settings = "duration_minutes" in pitch ? pitch : undefined;
  if (layout_repair && (settings || layout_repair.deck.research_id !== bundle.research_id ||
      layout_repair.deck.grounding_mode !== "verified" || !layout_repair.issues.length)) {
    throw new AppError(422, "The layout report must refer to a verified deck for this research context.");
  }
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
  const sections = bundle.findings.sections.flatMap(section => {
    if (!audience_text(section.heading)) return [];
    const paragraphs = section.paragraphs.filter(paragraph => audience_text(paragraph.prose) &&
      (settings || paragraph.support.length));
    return paragraphs.length ? [{ ...section, paragraphs }] : [];
  });
  const findings = sections.flatMap(section => {
    const result = section.paragraphs.map(paragraph => ({ heading: section.heading, text: paragraph.prose,
      evidence_ids: supported_ids(paragraph.support) }));
    approved_headings.set(section.heading, [...new Set(result.flatMap(item => item.evidence_ids))]);
    return result;
  });
  const subject = bundle.confirmed_brief.intent?.subject?.trim();
  const deck_title = subject && audience_text(subject) ? subject :
    audience_text(bundle.findings.title) ? bundle.findings.title : "Research presentation";
  approved_headings.set(deck_title, [...cited_records]);
  const saved_script = settings && bundle.pitch_script?.length ? bundle.pitch_script.filter(passage => audience_text(passage.prose)) : undefined;
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
  if (settings && (!passages.length || passages.some(passage => !passage.sentences.length ||
      passage.purpose === "point" && !passage.sentences[0].evidence_ids.length))) {
    throw new AppError(422, "The saved pitch needs supported narration before it can be presented.");
  }
  const duration = settings ? settings.duration_minutes * 60 - (settings.demo?.seconds ?? 0) : Infinity;
  const count = Math.min(pitch.slide_count ?? MAX_PRESENTATION_SLIDES, MAX_PRESENTATION_SLIDES);
  const audience = settings ? settings.audience.trim() || bundle.confirmed_brief.intent?.audience || "Audience in the confirmed brief" : "";
  let record_budget = presentation_evidence_budget;
  const context_records = settings ? [...cited_records].flatMap(id => {
    const { origin, passage, location } = records.get(id)!;
    const record = { id, origin, passage, location };
    const size = Buffer.byteLength(JSON.stringify(record), "utf8");
    if (size > record_budget) return [];
    record_budget -= size;
    return [record];
  }) : select_presentation_evidence(bundle);
  const eligible = settings ? records : new Map(context_records.map(record => [record.id, record]));
  if (!settings && !eligible.size) {
    throw new PresentationCoverageError(count, 0, ["No saved source supports the presentation objective yet."]);
  }
  const graphs = settings ? [] : saved_research_graphs(bundle).filter(({ graph, evidence_ids }) =>
    evidence_ids.every(id => eligible.has(id)) && audience_text(graph.name) &&
    audience_text(graph.description) && graph.data.every(point => audience_text(point.label)));
  const by_graph_id = new Map(graphs.map(item => [item.graph_id, item]));
  const evidence_numbers = new Map([...eligible].map(([id, entry]) => [id, numeric_tokens(entry.passage)]));
  const supported_numbers = (text: string, ids: string[]) => numeric_tokens(text).every(value =>
    ids.some(id => evidence_numbers.get(id)?.includes(value)));
  const literal_findings = settings ? [] : findings.flatMap(item => {
    const evidence_ids = item.evidence_ids.filter(id => eligible.has(id));
    const text = [...sentences.segment(item.text)].map(part => part.segment.trim())
      .filter(sentence => sentence && supported_numbers(sentence, evidence_ids)).join(" ");
    return text && evidence_ids.length ? [{ ...item, text, evidence_ids }] : [];
  });
  const all_evidence_ids = [...eligible.keys()];
  const grounded_objectives = (findings: TObjectiveFinding[]) => [...new Map(findings
    .filter(({ finding, evidence_ids }) => evidence_ids.every(id => eligible.has(id)) && supported_numbers(finding, evidence_ids))
    .map(finding => [finding.finding.toLowerCase(), finding])).values()];
  const calculation_note = /\b(?:calculat\w*|comput\w*|implied|derived)\b/iu;
  const known_gaps = settings ? [] : bundle.gaps.filter(speakable).slice(0, 30).map(gap => gap
    .split(/;\s*/u).filter(clause => !calculation_note.test(clause) || supported_numbers(clause, all_evidence_ids))
    .join("; ").slice(0, 500)).filter(Boolean);
  // Each rejected rule is traced by name, so a refused plan says why instead of silently falling back.
  // A slide that breaks a rule is dropped with its reason traced; the rest of the plan survives. Dropping the whole
  // plan for one unsupported figure used to send the deck to the research-wording fallback.
  const reject = (reason: string) => { trace_plan(bundle.research_id, "rejected_constraints:" + reason); return undefined; };
  const build = (beats: TPlanBeat[], feedback: string[], completion?: TPlanContext["completion"]) => {
    const candidate_limit = completion?.candidate_limit ?? (settings || layout_repair ? count : Math.min(MAX_PRESENTATION_SLIDES, count + 1));
    if (!beats.length || (!completion && beats.length > candidate_limit)) {
      feedback.push(`Return ${count} requested slides. A draft may contain at most ${candidate_limit} candidates for review.`);
      return reject("beat_count");
    }
    if (completion && beats.length > candidate_limit) trace_plan(bundle.research_id, "bounded_completion_candidates");
    const slides: TSlide[] = [];
    const retained = completion?.retained.map(({ beat }) => beat) ?? [];
    const fact_key = (beat: TPlanBeat) => JSON.stringify([[...beat.highlights].sort(), beat.sentences.map(sentence => sentence.text)])
      .toLowerCase();
    const titles = new Set(retained.map(beat => beat.title.toLowerCase()));
    const used_graphs = new Set(retained.flatMap(beat => beat.template.type === "saved_graph" ? [beat.template.graph_id] : []));
    const facts = new Set(retained.map(fact_key));
    const reserved_ids = new Set(completion?.retained.map(item => item.slide_id));
    let next_id = completion ? count : 0;
    const proposed_by_slide_id = new Map<string, TPlanBeat>();
    const visible_evidence = new Map<string, string[]>();
    const skip = (reason: string, title: string) => {
      trace_plan(bundle.research_id, "dropped_beat:" + reason);
      feedback.push(`Slide "${title}" was flagged (${reason}).`);
    };
    const has_evidence = (id: string) => settings ? cited_records.has(id) : eligible.has(id);
    for (const planned of beats) {
      const beat = without_commentary(planned);
      if (slides.length === candidate_limit) break;
      if (!audience_text(beat.title) || !beat.sentences.length) { skip("draft_instruction_or_missing_spoken_content", beat.title); continue; }
      const title_key = beat.title.toLowerCase();
      if (titles.has(title_key)) { skip("duplicate_title", beat.title); continue; }
      if (!beat.evidence_ids.length || !beat.evidence_ids.every(has_evidence)) {
        skip("uncited_evidence", beat.title);
        continue;
      }
      const used = beat.evidence_ids.map(id => eligible.get(id)!);
      const unsupported_visible = [beat.title, ...beat.highlights].find(text => !supported_numbers(text, beat.evidence_ids));
      if (unsupported_visible) { skip("unsupported_number_on_slide", beat.title); continue; }
      const unsupported_spoken = beat.sentences.find(sentence => !sentence.evidence_ids.every(has_evidence) ||
        !supported_numbers(sentence.text, sentence.evidence_ids));
      if (unsupported_spoken) { skip("unsupported_number_spoken", beat.title); continue; }
      let visual: TBeatVisual;
      if (beat.template.type === "saved_graph") {
        const saved = by_graph_id.get(beat.template.graph_id);
        if (!saved || used_graphs.has(saved.graph_id)) { skip("unknown_or_reused_graph", beat.title); continue; }
        used_graphs.add(saved.graph_id);
        visual = { ...beat, ...graph_visual(saved), evidence_ids: [...new Set([...beat.evidence_ids, ...saved.evidence_ids])] };
      } else {
        const supported = template_supported(beat.template, used);
        if (!supported) skip("template_downgraded:" + beat.template.type, beat.title);
        const template = supported ? beat.template : { type: "bullet_slide" as const };
        if (!beat.highlights.length && template.type === "bullet_slide") { skip("empty_text_slide", beat.title); continue; }
        visual = { ...beat, template };
      }
      const facts_on_slide = fact_key(beat);
      if (!settings && facts.has(facts_on_slide)) { skip("duplicate_takeaway", beat.title); continue; }
      facts.add(facts_on_slide);
      titles.add(title_key);
      while (reserved_ids.has(`slide-${next_id + 1}`)) next_id++;
      const id_index = next_id++;
      const script = beat.sentences.flatMap(sentence => Array.from(sentences.segment(sentence.text), part => part.segment.trim())
        .filter(Boolean).map(text => ({ text, evidence_ids: [...new Set(sentence.evidence_ids)] })))
        .map((sentence, index) => ({ ...sentence, sentence_id: `beat-${id_index + 1}-sentence-${index + 1}` }));
      const slide = compile_beat(visual, script, script.map(sentence => sentence.text).join(" "), id_index, beats.length);
      slides.push(slide);
      visible_evidence.set(slide.slide_id, visual.evidence_ids);
      proposed_by_slide_id.set(slide.slide_id, { ...beat, template: beat.template.type === "saved_graph"
        ? beat.template : visual.template! });
    }
    if (!slides.length) return reject("no_usable_beats");
    const kept = slide_layouts(slides);
    return kept.reduce((total, slide) => total + slide.estimated_seconds!, 0) <= duration
      ? { slides: kept, proposed_by_slide_id, visible_evidence } : reject("over_duration");
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
    findings: settings ? findings.slice(0, 55).map(item => ({ ...item, text: item.text.slice(0, 480) })) : literal_findings,
    ...(!settings && { context_assessment: {
      title: deck_title,
      ...(bundle.confirmed_brief.intent?.outcome && speakable(bundle.confirmed_brief.intent.outcome) &&
        { objective: bundle.confirmed_brief.intent.outcome }),
      ...(bundle.confirmed_brief.intent?.audience && speakable(bundle.confirmed_brief.intent.audience) &&
        { audience: bundle.confirmed_brief.intent.audience }),
      known_gaps,
    } }),
    ...(layout_repair && { layout_repair: {
      slides: layout_repair.deck.slides.map(({ slide_id, title, highlights, template, evidence_ids, chart_period }) =>
        ({ slide_id, title, highlights, template, evidence_ids, chart_period })),
      issues: layout_repair.issues.filter(item => layout_repair.deck.slides.some(slide => slide.slide_id === item.slide_id))
        .slice(0, 24).map(item => ({ ...item, viewport: item.viewport?.slice(0, 64), note: item.note?.slice(0, 240) })),
    } }),
    evidence: context_records,
  };
  // Enforce required host facts as objective findings, so a count-only deck that omits one is not accepted.
  const required = required_host_note(bundle);
  const host_findings = settings ? [] : context_records.filter(({ origin, passage }) => origin === "host" && required(passage))
    .map(({ id, passage }) => ({ finding: passage.slice(0, 240), evidence_ids: [id] }));
  if (host_findings.length) context.objective_findings = [...host_findings, ...(context.objective_findings ?? [])].slice(0, 8);
  if (context.layout_repair && !context.layout_repair.issues.length) throw new AppError(422, "The layout report needs valid slide IDs.");
  const brief = bundle.confirmed_brief;
  const coverage_brief: TGroundingCoverageBrief | undefined = context.context_assessment?.objective && brief.intent ? {
    summary: speakable(brief.summary) ? brief.summary : deck_title, intent: brief.intent, messages: [],
  } : undefined;
  let output_repairs_left = 3;
  const request_candidate = async (initial: TPlanContext) => {
    let request = initial;
    for (;;) {
      signal?.throwIfAborted();
      try {
        return await plan(request, bundle.research_id, signal);
      } catch (error) {
        signal?.throwIfAborted();
        if (!can_repair_plan_output(error) || !output_repairs_left) throw error;
        output_repairs_left--;
        trace_plan(bundle.research_id, "structured_output_repair");
        const feedback = [...plan_output_feedback(error), ...(request.review_feedback ?? [])];
        request = { ...initial, review_feedback: [...new Set(feedback)].slice(0, 10) };
      }
    }
  };
  const propose = async (request: TPlanContext): Promise<TPlanAttempt> => {
    signal?.throwIfAborted();
    const attempt: TPlanAttempt = { slides: [], verified_beats: [], feedback: [], objectives: request.objective_findings ?? [] };
    try {
      const model_output = await request_candidate(request);
      signal?.throwIfAborted();
      const planned = (request.completion ? completion_output : settings ? planner_output : assessed_output).safeParse(model_output);
      if (!planned.success) {
        trace_plan(bundle.research_id, model_output === undefined ? "provider_unavailable" : "rejected_schema");
        return { ...attempt, unavailable: model_output === undefined, feedback: ["Return a complete plan in the requested format."] };
      }
      const { data } = planned;
      const readiness = "readiness" in data ? data.readiness : undefined;
      attempt.assessment = readiness;
      attempt.rationale = data.rationale;
      const preferences = "objective_findings" in data && Array.isArray(data.objective_findings)
        ? grounded_objectives(data.objective_findings) : [];
      if (readiness?.status === "insufficient") return attempt;
      const anchors = new Map<string, string | null>();
      const retained_ids = new Set(request.completion?.retained.map(({ slide_id }) => slide_id));
      const beats = "beats" in data ? data.beats : data.additions.flatMap(({ after_slide_id, beat }) => {
        if (anchors.has(beat.title) || after_slide_id !== null && !retained_ids.has(after_slide_id)) return [];
        anchors.set(beat.title, after_slide_id);
        return [beat];
      });
      const proposed = build(beats, attempt.feedback, request.completion);
      if (!proposed) return attempt;
      const review = await verify(proposed.slides, settings ? bundle.evidence : context_records, bundle.research_id, signal, settings
        ? undefined : { visible_evidence: proposed.visible_evidence, coverage_brief: request.completion ? undefined : coverage_brief });
      signal?.throwIfAborted();
      if (typeof review === "object") {
        attempt.feedback.unshift(...review.feedback);
        attempt.unavailable = review.unavailable;
        if (review.omissions?.length) attempt.objectives = grounded_objectives([...attempt.objectives, ...review.omissions]);
      }
      const verified = verified_slides(proposed.slides, review, proposed.visible_evidence);
      attempt.slides = settings ? verified : select_verified_slides(verified, request.completion?.missing ?? count, attempt.objectives, preferences);
      attempt.verified_beats = attempt.slides.map(slide => {
        const beat = proposed.proposed_by_slide_id.get(slide.slide_id)!;
        if (typeof review === "boolean" || !review.revised_narration?.[slide.slide_id]) return beat;
        return { ...beat, sentences: slide.sentences!.map(({ text, evidence_ids }) => ({ text, evidence_ids })) };
      });
      if (request.completion) attempt.anchors = new Map(attempt.slides.map(slide => [slide.slide_id, anchors.get(slide.title)!]));
      trace_plan(bundle.research_id, verified.length === proposed.slides.length ? "accepted" :
        verified.length ? "accepted_verified_subset" : "rejected_verification",
        { requested: count, generated: beats.length, eligible: proposed.slides.length, verified: verified.length });
      const missing = uncovered_objectives(attempt.slides, attempt.objectives);
      if (missing.length) {
        // Local trace only: name what the plan still lacks so a failed deck can be diagnosed.
        trace_plan(bundle.research_id, "objective_findings_missing", { missing: missing.map(({ finding }) => finding.slice(0, 200)),
          verified: attempt.slides.length, feedback: attempt.feedback.slice(missing.length, missing.length + 4).map(item => item.slice(0, 200)) });
        attempt.feedback.unshift(...missing.map(({ finding }) => `Still needed for the presentation objective: ${finding}`));
      }
      if (verified.length < proposed.slides.length) attempt.rationale += " The deck retains the slides with checked content.";
      return attempt;
    } catch (error) {
      signal?.throwIfAborted();
      if (NoObjectGeneratedError.isInstance(error)) {
        trace_plan(bundle.research_id, "structured_output_rejected");
        return { ...attempt, unavailable: true, output_rejected: true };
      }
      log_failure("presentation.plan", error, { research_id: bundle.research_id });
      trace_plan(bundle.research_id, "proposal_failed");
      return { ...attempt, unavailable: true };
    }
  };
  const first = await propose(context);
  const verified_count = first.slides.length;
  const missing_evidence = (attempt: TPlanAttempt, retained: TSlide[]) => {
    const assessment = attempt.assessment;
    if (attempt.unavailable || !assessment || assessment.status === "ready") return;
    const gaps = [...new Set(assessment.gaps)];
    if (gaps.length) return new PresentationCoverageError(count, retained.length, gaps, retained);
  };
  if (!settings && !layout_repair && first.assessment?.status === "insufficient") {
    const coverage_failure = missing_evidence(first, first.slides);
    if (coverage_failure) throw coverage_failure;
  }
  let repaired: TPlanAttempt | undefined;
  const needs_count_repair = !settings && verified_count < count;
  const can_complete = needs_count_repair && verified_count > 0 && first.assessment?.status === "ready" && !first.unavailable;
  if (!first.output_rejected && !layout_repair && ((needs_count_repair && !can_complete) || (!verified_count && first.feedback.length))) {
    trace_plan(bundle.research_id, "repair_requested");
    const count_feedback = needs_count_repair ? [
      `The first plan retained ${verified_count} of ${count} requested slides. Return the entire ordered deck and reach ${count} distinct slides. Keep the verified beats and replace or fill in the missing ones. Mine the actual passages for specific independent takeaways, including ones from the same passage. Use a short text slide when the evidence does not bind a visual precisely. Keep every reporting period, estimate and qualifier. Name genuinely missing evidence in readiness.gaps.`,
    ] : [];
    repaired = await propose({
      ...context, review_feedback: [...count_feedback, ...first.feedback].slice(0, 10),
      ...(needs_count_repair && verified_count > 0 && { verified_beats: first.verified_beats }),
      ...(first.objectives.length > 0 && { objective_findings: first.objectives }),
    });
  }
  let selected = repaired && repaired.slides.length >= verified_count && !repaired.unavailable ? repaired : first;
  let added: TPlanAttempt | undefined;
  for (let round = 0; !settings && !layout_repair &&
      selected.slides.length < count && selected.assessment?.status === "ready" && round < max_completion_rounds; round++) {
    const missing = count - selected.slides.length;
    const objective_findings = uncovered_objectives(selected.slides, selected.objectives);
    trace_plan(bundle.research_id, "complete_verified_deck");
    added = await propose({
      ...context, completion: { missing, candidate_limit: Math.min(MAX_PRESENTATION_SLIDES, missing + 1),
        retained: selected.slides.map(({ slide_id }, index) =>
        ({ slide_id, beat: selected.verified_beats[index] })) },
      ...(objective_findings.length > 0 && { objective_findings }),
      review_feedback: [...new Set([
        ...(!selected.slides.length ? [`No original slide passed review. Draft ${missing} separate, substantive slides directly from the cited passages. Use a null anchor for each. Do not repeat the same measurement as a title or summary slide.`] : []),
        ...(added?.feedback ?? []), ...selected.feedback,
      ])].slice(0, 8),
    });
    if (added.anchors?.size && added.slides.length) {
      const places = new Map<string | null, TSlide[]>();
      const verified_by_id = new Map(selected.slides.map(({ slide_id }, index) => [slide_id, selected.verified_beats[index]]));
      for (const [index, slide] of added.slides.slice(0, missing).entries()) {
        const anchor = added.anchors.get(slide.slide_id) ?? null;
        const following = places.get(anchor) ?? [];
        following.push(slide);
        places.set(anchor, following);
        verified_by_id.set(slide.slide_id, added.verified_beats[index]);
      }
      const ordered = [...(places.get(null) ?? []),
        ...selected.slides.flatMap(slide => [slide, ...(places.get(slide.slide_id) ?? [])])];
      selected = { ...selected, slides: slide_layouts(ordered),
      verified_beats: ordered.map(slide => verified_by_id.get(slide.slide_id)!),
      rationale: added.rationale ?? selected.rationale, assessment: added.assessment ?? selected.assessment };
    }
    if (added.unavailable || added.assessment?.status === "insufficient") break;
  }
  const unfulfilled = uncovered_objectives(selected.slides, selected.objectives);
  if (!settings && (selected.slides.length !== count || unfulfilled.length)) {
    trace_plan(bundle.research_id, "requested_count_not_met", {
      requested: count, generated: selected.slides.length, eligible: selected.slides.length, verified: selected.slides.length,
    });
    if (layout_repair) throw new AppError(422, "The layout repair did not produce a verified candidate. Keep the previous draft.");
    if (added?.unavailable || repaired?.unavailable || first.unavailable && !repaired) {
      throw new DeckPreparationError("provider_unavailable", "Slide planning or fact-checking is unavailable. Try again shortly.", [], selected.slides, 503);
    }
    const coverage_failure = [added, repaired, first].flatMap(attempt => attempt ?
      missing_evidence(attempt, selected.slides) ?? [] : [])[0];
    if (coverage_failure) throw coverage_failure;
    const message = unfulfilled.length ? "The reviewed slides did not cover every part of the presentation objective." :
      `Only ${selected.slides.length} of ${count} requested slides passed review.`;
    throw new DeckPreparationError("grounding_failed", message, unfulfilled.map(finding => finding.finding), selected.slides);
  }
  const selected_plan = selected.slides.length ? selected : undefined;
  let slides = selected_plan?.slides;
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
      const visible = candidates.filter(item => audience_text(item.text) && short_text(110).safeParse(item.text).success).slice(0, 2);
      const selected_heading = [...group.map(passage => passage.heading), deck_title].find(heading =>
        heading && !used_titles.has(heading.toLowerCase()) && short_text(72).safeParse(heading).success &&
        numeric_tokens(heading).every(value => (approved_headings.get(heading) ?? []).some(id =>
          numeric_tokens(records.get(id)!.passage).includes(value))));
      const title = selected_heading ?? "Verified finding " + (index + 1);
      used_titles.add(title.toLowerCase());
      const heading_ids = selected_heading ? approved_headings.get(selected_heading) ?? [] : [];
      return compile_beat({
        title, highlights: visible.map(item => item.text),
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
