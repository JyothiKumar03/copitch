import { selected_chart } from "./pitch-chart";
import { mark_units, unit_legend } from "./research-table-units";
import type {
  TEvidence, TGroundingCoverage, TGroundingCoverageBrief, TGroundingOmission, TGroundingReview,
  TGroundingUnit, TResearchDraft, TResearchProvider,
} from "../types/research";

const max_review_bytes = 120_000;
const max_coverage_bytes = 44_000;
const max_omissions = 8;
const json_bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");

const scales = { thousand: 1e3, lakh: 1e5, million: 1e6, crore: 1e7, billion: 1e9, trillion: 1e12 };
const amounts = /(?<![\p{L}\d.])(\d+(?:,\d{2,3})*(?:\.\d+)?)(?:\s+(thousand|lakhs?|million|crores?|billion|trillion)\b)?/giu;
const scale_for = (unit: string) => scales[unit.toLowerCase().replace(/s$/, "") as keyof typeof scales];
const unit_scale = /\b(thousand|lakhs?|million|crores?|billion|trillion)\b/iu;
const row_marker = /^\s*(?:.*?\s)?([\p{L}\p{Sc}%]{1,3})\s*:\s*(?=[\d+-])/u;

const record_source = ({ id, origin, source_id, url }: TEvidence) => JSON.stringify([origin, source_id ?? url ?? id]);

const scoped_legend_scales = (records: TEvidence[]) => {
  const sources = new Map<string, Map<string, number>>();
  for (const record of records) {
    const legend = unit_legend(record);
    if (!legend) continue;
    const key = record_source(record);
    const markers = sources.get(key) ?? new Map<string, number>();
    for (const { marker, text } of mark_units(legend)) {
      const unit = unit_scale.exec(text)?.[1];
      const scale = unit ? scale_for(unit) : 1;
      const recorded = markers.get(marker);
      markers.set(marker, recorded === undefined || recorded === scale ? scale : 0);
    }
    sources.set(key, markers);
  }
  return sources;
};

const unsupported_magnitude = (text: string, records: TEvidence[], legends: ReturnType<typeof scoped_legend_scales>) => {
  const claims = [...text.matchAll(amounts)].filter(match => match[2]);
  if (!claims.length) return;
  const stated = records.flatMap(record => {
    let table_scale = 1;
    const markers = legends.get(record_source(record));
    return record.passage.split(/\r?\n/u).flatMap(line => {
      const header = /\bvalues? in (thousand|lakhs?|million|crores?|billion|trillion)\b/iu.exec(line);
      if (header) table_scale = scale_for(header[1]);
      const marker = row_marker.exec(line)?.[1].toLowerCase();
      const row_scale = marker ? markers?.get(marker) || 1 : line.includes("|") && !header ? table_scale : 1;
      return [...line.matchAll(amounts)].map(([, raw, suffix]) =>
        Number(raw.replaceAll(",", "")) * (suffix ? scale_for(suffix) : row_scale));
    });
  });
  for (const [phrase, raw, unit] of claims) {
    const number = Number(raw.replaceAll(",", ""));
    const scale = scale_for(unit);
    const decimals = raw.split(".")[1]?.length ?? 0;
    const matches = stated.some(value => value / scale === number ||
      (decimals >= 2 && Number((value / scale).toFixed(decimals)) === number));
    if (!matches) return phrase;
  }
};

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
  // Keep completeness sources separate so they cannot back a unit that failed to cite them.
  const cited = new Set(units.flatMap(unit => unit.support.map(ref => ref.evidence_id)));
  const records = evidence.filter(row => cited.has(row.id));
  const passages = new Map(records.map(row => [row.id, row.passage]));
  for (const unit of units) unit.support = [...new Map(unit.support.map(ref => {
    const excerpt = passages.get(ref.evidence_id) === ref.excerpt ? "" : ref.excerpt;
    return [`${ref.evidence_id}\n${excerpt}`, { evidence_id: ref.evidence_id, excerpt }] as const;
  })).values()];
  return { units, evidence: records, gaps: [...gaps, ...draft.gaps] };
};

const coverage_payload = (review: TGroundingReview, records: TEvidence[], brief: TGroundingCoverageBrief, previous_findings?: string): TGroundingCoverage | undefined => {
  const intent = brief.intent && {
    subject: brief.intent.subject.slice(0, 600), audience: brief.intent.audience.slice(0, 600),
    outcome: brief.intent.outcome.slice(0, 1_200), deliverable: brief.intent.deliverable.slice(0, 600),
  };
  const coverage: TGroundingCoverage = {
    brief: { summary: brief.summary.slice(0, 3_600), intent, messages: brief.messages.slice(-8).map(text => text.slice(0, 750)) },
    evidence: [],
    ...(previous_findings && { previous_findings }),
  };
  let remaining = Math.min(max_coverage_bytes, max_review_bytes - json_bytes({ ...review, coverage }));
  if (remaining < 0) return;
  const cited = new Set(review.evidence.map(record => record.id));
  for (const { id, origin, location, passage, url } of records) {
    if (cited.has(id)) continue;
    const record = { id, origin, location, passage, url };
    const size = json_bytes(record) + 1;
    if (size > remaining) continue;
    coverage.evidence.push(record);
    remaining -= size;
  }
  return coverage;
};

const coverage_feedback = (review: TGroundingReview, omissions: TGroundingOmission[] | undefined) => {
  if (!review.coverage || !Array.isArray(omissions)) return;
  const eligible = new Set([...review.evidence, ...review.coverage.evidence].map(record => record.id));
  const seen = new Set<string>();
  const feedback: string[] = [];
  for (const omission of omissions) {
    if (typeof omission?.finding !== "string" || typeof omission.reason !== "string" || !Array.isArray(omission.evidence_ids)) continue;
    const finding = omission.finding.trim().slice(0, 700);
    const reason = omission.reason.trim().slice(0, 320);
    const ids = [...new Set(omission.evidence_ids)];
    const key = finding.toLowerCase();
    if (!finding || !reason || !ids.length || ids.length > 12 || seen.has(key) || !ids.every(id => eligible.has(id))) continue;
    seen.add(key);
    feedback.push(`Consider adding ${finding} (source records ${ids.join(", ")}). ${reason}`);
    if (feedback.length === max_omissions) break;
  }
  return feedback;
};

export const verify_draft = async (draft: TResearchDraft, evidence: TEvidence[], gaps: string[],
  provider: TResearchProvider, signal: AbortSignal, on_verify?: () => void, on_skip?: (reason: string) => void,
  coverage_brief?: TGroundingCoverageBrief, previous_findings?: string):
  Promise<{prose:boolean;chart:boolean;decisions?:Map<string,string>;feedback?:string[];coverage_feedback?:string[]}> => {
  const withheld = { prose:false,chart:false };
  if (!provider.verify || signal.aborted) return withheld;
  const review = review_payload(draft, evidence, gaps);
  if (review.units.length > 80 || json_bytes(review) > max_review_bytes) {
    on_skip?.(`The draft was too large to check (${review.units.length} units). Requested a shorter one.`);
    return withheld;
  }
  if (coverage_brief) review.coverage = coverage_payload(review, evidence, coverage_brief, previous_findings);
  on_verify?.();
  const deadline = AbortSignal.timeout(20000);
  try {
    const result = await provider.verify(review, AbortSignal.any([signal, deadline]));
    const verdicts = Array.isArray(result) ? result : result.verdicts;
    const decisions = new Map(verdicts.map(v => [v.id,v.decision]));
    if (signal.aborted || verdicts.length !== review.units.length || decisions.size !== review.units.length ||
      !review.units.every(unit => ["supported","unsupported","missing_qualification"].includes(decisions.get(unit.id) ?? ""))) {
      if (!signal.aborted) on_skip?.(`The fact-check returned ${decisions.size} decisions for ${review.units.length} units and could not be applied.`);
      return withheld;
    }
    const by_id = new Map(verdicts.map(verdict => [verdict.id, verdict]));
    if (coverage_brief) {
      const records = new Map(review.evidence.map(record => [record.id, record]));
      const legends = scoped_legend_scales(evidence);
      for (const unit of review.units) {
        if (decisions.get(unit.id) !== "supported" || unit.id === "pitch-chart") continue;
        const unsupported = unsupported_magnitude(unit.text, unit.support.flatMap(ref => records.get(ref.evidence_id) ?? []), legends);
        if (!unsupported) continue;
        decisions.set(unit.id, "unsupported");
        by_id.set(unit.id, { id: unit.id, decision: "unsupported",
          reason: `The stated magnitude ${unsupported} does not match the cited values.` });
      }
    }
    return {
      prose:review.units.every(unit => unit.id === "pitch-chart" || decisions.get(unit.id) === "supported"),
      chart:decisions.get("pitch-chart") === "supported",
      decisions,
      coverage_feedback: coverage_feedback(review, Array.isArray(result) ? undefined : result.omissions),
      feedback: review.units.flatMap(unit => {
        const verdict = by_id.get(unit.id);
        if (!verdict || verdict.decision === "supported") return [];
        return [`${unit.kind} ${unit.id} (${verdict.decision}): ${unit.text.slice(0, 450)}. ${verdict.reason?.slice(0, 240) ?? ""}`];
      }).slice(0, 20),
    };
  } catch {
    if (!signal.aborted) on_skip?.(deadline.aborted ? "The fact-check reached its time limit." : "The fact-check could not return usable decisions.");
    return withheld;
  }
};

// Keep only what the checker found supported: a weak paragraph is dropped, it does not sink a document of verified ones.
export const keep_supported = (draft: TResearchDraft, decisions: Map<string, string>, fallback_title: string) => {
  const ok = (id: string) => decisions.get(id) === "supported";
  const sections = draft.sections.flatMap((section, i) => {
    const paragraphs = section.paragraphs.filter((_, j) => ok(`paragraph-${i}-${j}`));
    if (!paragraphs.length) return [];
    if (ok("section-" + i)) return [{ ...section, paragraphs }];
    return [{ heading: "Source findings", paragraphs }];
  });
  const script = (draft.pitch_script ?? []).filter((_, i) => ok("pitch-" + i));
  const complete = script.length >= 3 && script[0].purpose === "opening" && script.at(-1)?.purpose === "close";
  return { ...draft, title: ok("title") ? draft.title : fallback_title, sections, pitch_script: complete ? script : undefined };
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
