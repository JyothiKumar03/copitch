import { csv_chart_candidates } from "./source-csv";
import type { TEvidence, TResearchBundle } from "../types/research";
import type { TPitchChart, TPitchChartCandidate, TPitchChartPoint, TPitchChartSelection } from "../types/pitch-artifact";
import { chart_for_findings } from "./conversion-metrics";

const month_index = (label: string) => {
  const iso = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(label);
  if (iso) return Number(iso[1]) * 12 + Number(iso[2]) - 1;
  const months = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  const match = /^([a-z]+)(?:\s+(\d{4}))?$/i.exec(label);
  if (!match) return null;
  const index = months.findIndex(m => [m,m.slice(0,3)].includes(match[1].toLowerCase()));
  return index < 0 ? null : Number(match[2] ?? 0) * 12 + index;
};

const rate_point = (label: string, evidence_id: string, numerator: number, denominator: number): TPitchChartPoint =>
  ({ label, evidence_id, numerator, denominator, value: denominator ? Number((100 * numerator / denominator).toFixed(6)) : null, unit:"%" });

export const chart_candidates = (evidence: TEvidence[]): TPitchChartCandidate[] => {
  const options = csv_chart_candidates(evidence);
  for (const row of evidence) {
    if (row.origin === "host" || !/^[A-Z]\d+$/.test(row.id)) continue;
    const metric = row.metric;
    if (metric && row.derived_from?.length && row.source_id) {
      const segment = metric.segment ?? "Overall";
      const group = JSON.stringify([row.source_id,metric.month]);
      const point = rate_point(segment,row.id,metric.numerator,metric.denominator);
      options.push({ id: row.id + "-segment", group, measure: "Conversion rate" + (metric.month ? " · " + metric.month : ""), date:null, point });
      if (metric.month && month_index(metric.month) !== null) options.push({
        id: row.id + "-month", group:JSON.stringify([row.source_id,segment,"time"]), measure:"Conversion rate · " + segment,
        date:month_index(metric.month), point:{...point,label:metric.month},
      });
    } else if (!metric) {
      // Only stand-alone, labeled measurements. Free prose can qualify a number with a forecast, negation or comparison.
      for (const [i,line] of row.passage.split(/\r?\n/).entries()) {
        const match = /^\s*(revenue|cost|spend)\s+(?:in|for)\s+([a-z]{3,9}\s+\d{4}|\d{4}-\d{2})\s*:\s*(USD|EUR|GBP)\s+((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)\.?\s*$/i.exec(line);
        if (!match) continue;
        const [,measure,label,unit,amount] = match;
        const date = month_index(label);
        const value = Number(amount.replaceAll(",",""));
        if (date === null || !Number.isSafeInteger(Math.round(value * 100))) continue;
        const name = measure[0].toUpperCase() + measure.slice(1).toLowerCase();
        options.push({ id:row.id + "-line-" + i,group:JSON.stringify([row.source_id ?? row.url ?? row.id,name,unit.toUpperCase()]),
          measure:name,date,point:{label,value,unit:unit.toUpperCase(),evidence_id:row.id} });
      }
    }

  }
  const sources = new Map(evidence.map(e => [e.id,e.source_id ?? e.url ?? e.id]));
  const groups = new Map<string, TPitchChartCandidate[]>();
  for (const option of options) {
    const series = groups.get(option.group) ?? [];
    series.push(option);
    groups.set(option.group,series);
  }
  const by_source = new Map<string, TPitchChartCandidate[][]>();
  for (const series of groups.values()) {
    if (series.length < 2 || series.length > 80) continue;
    const source = sources.get(series[0].point.evidence_id)!;
    const queue = by_source.get(source) ?? [];
    queue.push(series);
    by_source.set(source,queue);
  }
  // Give each source a turn before adding another series from the same source.
  const bounded: TPitchChartCandidate[] = [];
  while (by_source.size) {
    for (const [key,queue] of by_source) {
      const series = queue.shift()!;
      if (bounded.length + series.length <= 80) bounded.push(...series);
      if (!queue.length) by_source.delete(key);
    }
  }
  return bounded;
};

export const selected_chart = (selection: TPitchChartSelection | null | undefined, evidence: TEvidence[]): TPitchChart | undefined => {
  if (!selection || !["bar","line"].includes(selection.type) || selection.candidate_ids.length < 2 || selection.candidate_ids.length > 12) return;
  const choices = new Map(chart_candidates(evidence).map(c => [c.id,c]));
  const points: TPitchChartCandidate[] = [];
  for (const id of selection.candidate_ids) {
    const candidate = choices.get(id);
    if (!candidate || (points.length && (candidate.group !== points[0].group || candidate.point.unit !== points[0].point.unit || candidate.measure !== points[0].measure))) return;
    points.push(candidate);
  }
  if (new Set(points.map(c => c.point.label.toLowerCase())).size !== points.length || !points.some(c => c.point.value !== null)) return;
  if (selection.type === "line") {
    if (points.some(c => c.date === null) || new Set(points.map(c => c.date)).size !== points.length) return;
    points.sort((a,b) => a.date! - b.date!);
  }
  const unit = points[0].point.unit;
  const description = points.every(c => c.point.denominator !== undefined && c.point.numerator !== undefined) ? "Conversions divided by trials, in percent. A zero denominator is unavailable." : unit === "value" ? "Reported values from the cited source." : "Reported values in " + unit + ".";
  return { name:points[0].measure, description, type:selection.type, data:points.map(c => c.point) };
};

export const artifact_chart = (bundle: TResearchBundle, cited: Set<string>): TPitchChart | undefined => {
  if (!bundle.grounding || bundle.grounding.chart === "withheld") return;
  if (bundle.grounding.mode !== "verified" && bundle.grounding.chart !== "verified") return;
  if (bundle.pitch_chart !== undefined) return selected_chart(bundle.pitch_chart,bundle.evidence);
  // Legacy verified syntheses predate explicit chart decisions. Require a cited conversion series with a real comparison.
  const legacy = chart_for_findings(cited,bundle.evidence ?? []);
  if (!legacy || legacy.rows.length < 2 || !legacy.rows.some(r => r.denominator > 0)) return;
  return { name:"Conversion rate" + (legacy.period ? " · " + legacy.period : ""),type:"bar",
    description:"Conversions divided by trials, in percent. A zero denominator is unavailable.",
    data:legacy.rows.map(r => rate_point(r.label,r.evidence_id,r.numerator,r.denominator)) };
};
