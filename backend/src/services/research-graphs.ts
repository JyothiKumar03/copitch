import { once } from "node:events";
import type { Response } from "express";
import { z } from "zod";
import type { TResearchGraph, TResearchGraphPoint } from "../../../shared/research-graphs";
import type { TEvidence, TGraphRepairInput, TGroundingUnit, TResearchBundle, TResearchProvider, TVerifiedResearchGraph } from "../types/research";
import { quotes } from "./excerpt";
import { mark_units, unit_legend } from "./research-table-units";

const max_graphs = 3;
const max_review_bytes = 70000;
const plain = (max: number) => z.string().trim().min(1).max(max).refine(text => !/[<>]/u.test(text) &&
  [...text].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127));
const point_schema = z.strictObject({
  label: plain(100), value: z.number().finite().min(-1e15).max(1e15), unit: plain(32), period: plain(64),
  evidence_id: z.string().regex(/^[A-Z]\d+$/u), excerpt: z.string().trim().min(1).max(1500),
});
const graph_schema = z.strictObject({
  name: plain(120), description: plain(300), type: z.enum(["bar", "line"]), data: z.array(point_schema).min(2).max(12),
});
const saved_graph_schema = graph_schema.extend({ data: z.array(point_schema.omit({ excerpt: true })).min(2).max(12) });
type TGraphDraft = z.infer<typeof graph_schema>;
type TGraphPointDraft = z.infer<typeof point_schema>;
type TBoundPoint = TGraphPointDraft & { unit_source?: { evidence_id: string; excerpt: string } };
type TBoundGraph = Omit<TGraphDraft, "data"> & { data: TBoundPoint[] };
export type TGraphVerifier = NonNullable<TResearchProvider["verify"]>;
type TGraphRepair = NonNullable<TResearchProvider["repair_graph"]>;

export const graph_writer_instructions = `Suggest zero to three graphs only when the cited records report genuinely useful comparable measurements, including public numeric tables and category breakdowns. In graph_xml, return only standalone <graph>{"name":"…","description":"…","type":"bar","data":[{"label":"…","value":12.3,"unit":"USD million","period":"FY 2025–26","evidence_id":"P1","excerpt":"verbatim text from that record"}]}</graph> blocks, or null. Use two to twelve distinct points per graph. All points use the same unit and magnitude. For bars use exact source category labels measured in the same reporting period. A simpler chart with fewer independently supported points is preferable to comparing incompatible rows. For lines use one measure across distinct periods at the same granularity (such as YYYY-MM or FY YYYY–YY, in order). Give the actual period and unit, including any currency or scale. Use only explicitly reported, exact values. Never plot forecasts, approximations, figures from different or overlapping windows as a category comparison, or values derived by guessing which table column goes with a number. Cite the evidence record containing the actual figures, and quote its category and value or full literal table row. Use the exact reporting column and measure marker. If one page has an explicit unit legend for the entire dataset and a later record has the rows, cite the record with the rows. Skip the graph when the number, unit or period cannot be tied to a source. Do not include HTML or Markdown inside a JSON field.`;

const normalize = (text: string) => text.normalize("NFKC").toLowerCase()
  .replace(/[‐‑‒–—−]/gu, "-").replace(/[’‘]/gu, "'").replace(/\s+/gu, " ").trim();
const normalize_period = (text: string) => normalize(text)
  .replace(/\b(?:fy|fiscal year)\s*(20\d\d)\s*-\s*(\d{2})\b(?![-\d])/gu, "$1-20$2")
  .replace(/\b(?:fy|fiscal year)\s*(?=\d)/gu, "")
  .replace(/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/gu, month => month.slice(0, 3))
  .replace(/\b([a-z]{3})\s*'(\d{2})\b/gu, "$1 20$2")
  .replace(/\b(20\d\d)\s*-\s*(\d\d)\b(?![-\d])/gu, (span, first: string, second: string) => Number(second) > 12 ? `${first}-20${second}` : span)
  .replace(/\s*-\s*/gu, "-").replace(/\b([a-z]{3})-([a-z]{3}) (20\d\d)\b/gu, "$1 $3-$2 $3");
const normalize_unit = (text: string) => normalize(text)
  .replace(/\bus\s*\$|\bu\.?s\.?\s+dollars?\b/gu, " usd ")
  .replace(/\b(?:metric\s+ton(?:ne)?s?|m\s*ts?)\b/gu, " metric tonnes ")
  .replace(/\b(?:percent|per\s+cent)\b/gu, "%")
  .replace(/\b(thousand|million|billion|trillion|lakh|crore)s\b/gu, "$1");
const unit_parts = (text: string): string[] => (normalize_unit(text).match(/[\p{L}\p{N}]+|[%$£€₹]/gu) ?? []).sort();
const unit_key = (text: string) => unit_parts(text).join(" ");
export const unit_supported = (unit: string, text: string) => {
  const words = (normalize_unit(text).match(/[\p{L}\p{N}]+|[%$£€₹]/gu) ?? []).filter(word => !/^\p{N}+$/u.test(word));
  const parts = unit_parts(unit);
  return parts.length > 0 && words.some((_, index) => words.slice(index, index + parts.length).sort().join(" ") === parts.join(" "));
};
const regex_escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const phrase_in = (text: string, phrase: string) => new RegExp(`(?<![\\p{L}\\p{N}])${regex_escape(phrase)}(?![\\p{L}\\p{N}])`, "u").test(text);

const date_order = (period: string) => {
  const normal = normalize_period(period);
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const iso = /^(20\d\d)(?:-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?)?$/u.exec(normal);
  if (iso) {
    const time = Date.UTC(Number(iso[1]), Number(iso[2] ?? 1) - 1, Number(iso[3] ?? 1));
    if (iso[3] && new Date(time).getUTCDate() !== Number(iso[3])) return;
    return { grain: iso[3] ? "day" : iso[2] ? "month" : "year", time };
  }
  const month = /^([a-z]{3}) (20\d\d)$/u.exec(normal);
  if (month && months.includes(month[1])) return { grain: "month", time: Date.UTC(Number(month[2]), months.indexOf(month[1])) };
  const quarter = /^q([1-4]) (20\d\d)$/u.exec(normal);
  if (quarter) return { grain: "quarter", time: Date.UTC(Number(quarter[2]), (Number(quarter[1]) - 1) * 3) };
  const fiscal = /^(20\d\d)-(20\d\d)$/u.exec(normal);
  if (fiscal && Number(fiscal[2]) === Number(fiscal[1]) + 1) return { grain: "fiscal", time: Date.UTC(Number(fiscal[1]), 0) };
};

const exact_amounts = /(?<![\p{L}\d.,+~≈<>≤≥])([+-]?\d+(?:,\d{2,3})*(?:\.\d+)?)(?![\d+]|[.,]\d|\s*\+)(?:\s*(thousand|lakhs?|million|crores?|billion|trillion))?(?![\p{L}\p{N}+])/gu;
const amount_in = (point: TGraphPointDraft) => [...normalize(point.excerpt).matchAll(exact_amounts)].some(([, number, scale]) =>
  Number(number.replaceAll(",", "")) === point.value && (!scale || unit_parts(point.unit).includes(scale.replace(/s$/u, ""))));

const column_period = (header: string) => normalize_period(header.replace(/\(.*\)/gu, "").replace(/\b%\s*change\b/giu, ""));
const table_binding = (point: TGraphPointDraft, passage: string) => {
  const rows = passage.split(/\r?\n/u);
  const headings = rows.find(line => /^Columns: /u.test(line) && line.includes("|"));
  if (!headings) return undefined;
  const columns = headings.slice("Columns: ".length).split(" · ").at(-1)!.split("|").map(item => item.trim());
  const period = normalize_period(point.period);
  const date = date_order(period);
  const matches_period = (heading: string) => {
    const period_in_heading = column_period(heading);
    const date_in_heading = date_order(period_in_heading);
    return period_in_heading === period || !!(date && date_in_heading?.grain === date.grain && date_in_heading.time === date.time);
  };
  const eligible_columns = columns.flatMap((column, index) => matches_period(column) ? [index] : []);
  const exact_cell = /^[+-]?\d+(?:,\d{2,3})*(?:\.\d+)?%?$/u;
  const quoted_rows = rows.filter(line => line !== headings && line.includes("|") && (quotes(point.excerpt, line) || quotes(line, point.excerpt)));
  if (!quoted_rows.length) return point.excerpt.includes("|") ? false : undefined;
  const percent = unit_key(point.unit) === "%";
  return quoted_rows.some(row => {
    const cells = row.split("|").map(cell => normalize(cell));
    const values = cells.slice(-columns.length);
    const row_label = cells.slice(0, -columns.length).join(" ");
    if (!row_label || values.length !== columns.length || !values.every(value => exact_cell.test(value))) return false;
    return (phrase_in(row_label, normalize(point.label)) || matches_period(point.label)) && eligible_columns.some(index =>
      (/%|percent/iu.test(columns[index]) || values[index].endsWith("%")) === percent && Number(values[index].replace(/[,%]/gu, "")) === point.value);
  });
};

const numeric_cell = "[+-]?\\d+(?:,\\d{2,3})*(?:\\.\\d+)?";
const fiscal_headers = /^(?:[^\d|]+\s+)((?:20\d{2}\s*-\s*\d{2}\*?\s+)+20\d{2}\s*-\s*\d{2}\*?)$/u;
const dated_block = new RegExp(`^(.+?):\\s+(${numeric_cell}(?:\\s+${numeric_cell})+)$`, "u");

// HTML tables sometimes arrive as text with a fiscal-year header and repeated unit-coded subrows.
const fiscal_table = (passage: string, legend: string) => {
  const lines = passage.split(/\r?\n/u);
  const frame = lines.findIndex(line => fiscal_headers.test(normalize(line)));
  if (frame < 0) return;
  const header = fiscal_headers.exec(normalize(lines[frame]))![1];
  const columns = (header.match(/20\d{2}\s*-\s*\d{2}/gu) ?? []).map(normalize_period);
  const markers = mark_units(legend);
  if (!markers.length || new Set(columns).size !== columns.length) return;
  const rows: { label: string; marker: string; unit: string; values: number[]; excerpt: string }[] = [];
  let label = "";
  let group_start = frame + 1;
  for (let i = frame + 1; i < lines.length; i++) {
    if (fiscal_headers.test(normalize(lines[i]))) break;
    const row = dated_block.exec(lines[i]);
    if (!row) { label = ""; continue; }
    const values = row[2].split(/\s+/u);
    const key = /^(?:(.+?)\s+)?([\p{L}\p{Sc}%]{1,3})$/u.exec(row[1]);
    const unit = key && markers.find(marker => marker.marker === key[2].toLowerCase());
    if (!unit || values.length !== columns.length) { label = ""; continue; }
    if (key?.[1]) { label = key[1]; group_start = i; }
    if (label) rows.push({ label, marker: unit.marker, unit: unit.text, values: values.map(value => Number(value.replaceAll(",", ""))),
      excerpt: lines.slice(group_start, i + 1).join("\n") });
  }
  return { columns, rows };
};

const fiscal_table_proof = (point: TGraphPointDraft, passage: string, legend: string): string | false | undefined => {
  const table = fiscal_table(passage, legend);
  const index = table?.columns.indexOf(normalize_period(point.period)) ?? -1;
  if (!table || index < 0) return;
  const matches = table.rows.filter(row => phrase_in(normalize(row.label), normalize(point.label)));
  if (matches.length) return matches.find(row => unit_supported(point.unit, row.unit) && row.values[index] === point.value)?.excerpt ?? false;
};

const eligible_point = (point: TGraphPointDraft, row: TEvidence | undefined, legends: Map<string, { record: TEvidence; text: string }>): TBoundPoint | undefined => {
  if (!row || row.origin === "host") return;
  const own_legend = unit_legend(row);
  const shared = row.url ? legends.get(row.url) : undefined;
  const legend = own_legend ?? shared?.text;
  const literal = quotes(row.passage, point.excerpt) && amount_in(point);
  if (legend) {
    const proof = fiscal_table_proof(point, row.passage, legend);
    if (proof === false) return;
    if (proof && proof.length <= 1500) return { ...point, excerpt: proof,
      ...(!own_legend && shared && { unit_source: { evidence_id: shared.record.id, excerpt: shared.text } }) };
  }
  if (!literal || !unit_supported(point.unit, row.passage)) return;
  const table = table_binding(point, row.passage);
  if (table !== undefined) return table ? point : undefined;
  if (phrase_in(normalize(point.excerpt), normalize(point.label)) &&
    phrase_in(normalize_period(row.passage), normalize_period(point.period))) return point;
};

const parse_graph = (input: string) => {
  if (input.length > 23000) return;
  try {
    const parsed = graph_schema.safeParse(JSON.parse(input));
    if (parsed.success) return parsed.data;
  } catch { /* Invalid model output cannot become a chart. */ }
};

const graphs_in = (input: string) => {
  const result: TGraphDraft[] = [];
  let depth = 0;
  let start = -1;
  for (const token of input.matchAll(/<\/?graph\b[^>]*>/giu)) {
    const [tag] = token;
    if (!tag.startsWith("</")) {
      if (depth++ === 0) start = tag === "<graph>" ? token.index + tag.length : -1;
      else start = -1;
    } else if (depth && --depth === 0 && start >= 0 && tag === "</graph>") {
      const graph = parse_graph(input.slice(start, token.index));
      if (graph) result.push(graph);
      if (result.length === max_graphs) break;
    }
  }
  return result;
};

const validated_order = (graph: TGraphDraft, records: Map<string, TEvidence>, legends: Map<string, { record: TEvidence; text: string }>): TBoundGraph | undefined => {
  const unit = unit_key(graph.data[0].unit);
  if (!unit || new Set(graph.data.map(point => normalize(point.label))).size !== graph.data.length ||
      graph.data.some(point => unit_key(point.unit) !== unit)) return;
  const period = normalize_period(graph.data[0].period);
  const dates = graph.data.map(point => date_order(point.period));
  if (graph.type === "bar") {
    if (!/\b(?:19|20)\d\d\b/u.test(period) || graph.data.some(point => normalize_period(point.period) !== period)) return;
  } else if (!dates[0] || dates.some(date => !date || date.grain !== dates[0]?.grain) || new Set(dates.map(date => date?.time)).size !== dates.length) return;
  const supported = graph.data.flatMap(point => eligible_point(point, records.get(point.evidence_id), legends) ?? []);
  if (supported.length < 2) return;
  if (graph.type === "line") supported.sort((a, b) => date_order(a.period)!.time - date_order(b.period)!.time);
  const description = supported.length === graph.data.length ? graph.description : graph.type === "bar"
    ? `Selected categories with source-backed values in ${supported[0].unit} for ${supported[0].period}.`
    : `Selected reporting periods with source-backed values in ${supported[0].unit}.`;
  return { ...graph, description, data: supported };
};

const canonical_graph = ({ name, description, type, data }: TGraphDraft): TResearchGraph => ({
  name, description, type,
  data: data.map(({ label, value, period, evidence_id }): TResearchGraphPoint => ({
    label, value, unit: data[0].unit, period: type === "bar" ? data[0].period : period, evidence_id,
  })),
});
const write_graph = (graph: TResearchGraph, extra_ids: string[]) => {
  const json = JSON.stringify(graph).replace(/</gu, "\\u003c").replace(/>/gu, "\\u003e").replace(/&/gu, "\\u0026");
  const cited = [...new Set([...graph.data.map(point => point.evidence_id), ...extra_ids])];
  return `<graph>${json}</graph>\n\nGraph sources ${cited.map(id => `[^${id}]`).join(" ")}`;
};

export const saved_research_graphs = (bundle: Pick<TResearchBundle, "context_markdown" | "verified_graphs" | "evidence">) => {
  if (bundle.verified_graphs) return bundle.verified_graphs;
  const ids = new Set(bundle.evidence.map(record => record.id));
  const result: TVerifiedResearchGraph[] = [];
  for (const match of (bundle.context_markdown ?? "").matchAll(/^<graph>(\{[^\n]{1,23000}\})<\/graph>\r?\n\r?\nGraph sources (\[\^[A-Z]\d+\](?: \[\^[A-Z]\d+\])*)\r?$/gmu)) {
    try {
      const parsed = saved_graph_schema.safeParse(JSON.parse(match[1]));
      const evidence_ids = [...new Set(Array.from(match[2].matchAll(/\[\^([A-Z]\d+)\]/gu), citation => citation[1]))];
      if (!parsed.success || evidence_ids.some(id => !ids.has(id))) continue;
      const graph = parsed.data;
      if (graph.data.some(point => !evidence_ids.includes(point.evidence_id) || point.unit !== graph.data[0].unit) ||
          new Set(graph.data.map(point => normalize(point.label))).size < graph.data.length) continue;
      const periods = new Set(graph.data.map(point => normalize_period(point.period)));
      if (periods.size !== (graph.type === "bar" ? 1 : graph.data.length)) continue;
      result.push({ graph_id: "graph-" + (result.length + 1), graph, evidence_ids });
      if (result.length === max_graphs) break;
    } catch { /* An invalid archived graph cannot become a slide. */ }
  }
  return result;
};

const review_graph = (graph: TBoundGraph, index: number): TGroundingUnit[] => {
  const support = (point: TBoundPoint) => [{ evidence_id: point.evidence_id, excerpt: point.excerpt }, ...(point.unit_source ? [point.unit_source] : [])];
  return [{ id: `graph-${index}-summary`, kind: "paragraph", text: `${graph.name}. ${graph.description} (${graph.type} graph; ${graph.data.map(point =>
    `${point.label}: ${point.value} ${point.unit}, ${point.period}`).join("; ")})`, support: graph.data.flatMap(support) },
  ...graph.data.map((point, i): TGroundingUnit => ({ id: `graph-${index}-point-${i}`, kind: "paragraph",
    text: `${graph.name}: ${point.label} reported ${point.value} ${point.unit} in ${point.period}.`, support: support(point) }))];
};

const graph_document = (graphs: TVerifiedResearchGraph[]) => ({
  graphs, graph_count: graphs.length,
  evidence_ids: [...new Set(graphs.flatMap(graph => graph.evidence_ids))],
  get markdown() { return graphs.map(({ graph, evidence_ids }) => write_graph(graph, evidence_ids)).join("\n\n"); },
});

export const serialize_research_graphs = (bundle: TResearchBundle) => graph_document(saved_research_graphs(bundle));

const empty_graphs = () => graph_document([]);

const graph_result = async (proposed: TGraphDraft[], evidence: TEvidence[], verify: TGraphVerifier, signal: AbortSignal) => {
  const empty = empty_graphs();
  const records = new Map(evidence.map(row => [row.id, row]));
  const legends = new Map(evidence.flatMap(record => {
    const text = record.origin === "public" && record.url && unit_legend(record);
    return text && record.url ? [[record.url, { record, text }] as const] : [];
  }));
  const candidates = proposed.flatMap(graph => validated_order(graph, records, legends) ?? []);
  const trace = (outcome: string, published = 0) => {
    if (process.env.TRACE_LOGS === "1") console.log(JSON.stringify({ operation: "research.graphs", outcome,
      proposed: proposed.length, eligible: candidates.length, published }));
  };
  if (!candidates.length) { trace("no_eligible_proposals"); return { output: empty, reason: "local" as const }; }
  const prepared = candidates.map((draft, i) => ({ draft, units: review_graph(draft, i) }));
  const ids = new Set(prepared.flatMap(graph => graph.units.flatMap(unit => unit.support.map(ref => ref.evidence_id))));
  const review = { units: prepared.flatMap(graph => graph.units), evidence: evidence.filter(record => ids.has(record.id)), gaps: [] };
  if (Buffer.byteLength(JSON.stringify(review), "utf8") > max_review_bytes) {
    trace("review_budget_exceeded");
    return { output: empty, reason: "unavailable" as const };
  }
  try {
    const result = await verify(review, AbortSignal.any([signal, AbortSignal.timeout(16000)]));
    const verdicts = Array.isArray(result) ? result : result.verdicts;
    const decisions = new Map(verdicts.map(verdict => [verdict.id, verdict.decision]));
    if (signal.aborted || verdicts.length !== review.units.length || decisions.size !== review.units.length || !review.units.every(unit => decisions.has(unit.id))) {
      trace("incomplete_review");
      return { output: empty, reason: "unavailable" as const };
    }
    const graphs = prepared.filter(graph => graph.units.every(unit => decisions.get(unit.id) === "supported")).map(({ draft }, index) => ({
      graph_id: "graph-" + (index + 1), graph: canonical_graph(draft),
      evidence_ids: [...new Set([
        ...draft.data.map(point => point.evidence_id), ...draft.data.flatMap(point => point.unit_source?.evidence_id ?? []),
      ])],
    }));
    trace("reviewed", graphs.length);
    const output = graph_document(graphs);
    return { output, reason: graphs.length ? "accepted" as const : "review" as const };
  } catch { trace("review_failed"); return { output: empty, reason: "unavailable" as const }; }
};

const chart_repair_evidence = (evidence: TEvidence[], original: TGraphDraft[]): TGraphRepairInput["evidence"] => {
  const cited = new Set(original.flatMap(graph => graph.data.map(point => point.evidence_id)));
  const ranked = evidence.flatMap(record => {
    if (record.origin === "host") return [];
    const numbers = [...normalize(record.passage).matchAll(exact_amounts)].length;
    const years = /\b(?:19|20)\d\d\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)'\d\d/iu.test(record.passage);
    const legend = !!unit_legend(record);
    if (!legend && (!years || numbers < 2)) return [];
    const fiscal = record.passage.split(/\r?\n/u).some(line => fiscal_headers.test(normalize(line)));
    const table = record.passage.includes("Columns: ");
    const score = (legend ? 30 : 0) + (fiscal ? 20 : table ? 10 : 0) + Math.min(numbers, 10) + (cited.has(record.id) ? 5 : 0);
    return [{ score, record }];
  }).sort((a, b) => b.score - a.score);
  const per_source = new Map<string, number>();
  const selected: TGraphRepairInput["evidence"] = [];
  let remaining = 24000;
  for (const { record } of ranked) {
    const { id, location, url, passage } = record;
    const key = url ?? record.source_id ?? id;
    const count = per_source.get(key) ?? 0;
    const item = { id, location, url, passage };
    const bytes = Buffer.byteLength(JSON.stringify(item));
    if (count >= 4 || bytes > remaining) continue;
    selected.push(item);
    per_source.set(key, count + 1);
    remaining -= bytes;
    if (selected.length === 14) break;
  }
  return selected;
};

const chart_repair_feedback = (proposed: TGraphDraft[], reason: "local" | "review") => {
  const feedback: string[] = [];
  if (!proposed.length) feedback.push("The original graph block did not match the required XML and JSON shape.");
  if (proposed.some(graph => new Set(graph.data.map(point => unit_key(point.unit))).size > 1)) {
    feedback.push("A chart mixed units or magnitudes. All points must use the same reported unit and scale.");
  }
  if (proposed.some(graph => graph.type === "bar" && new Set(graph.data.map(point => normalize_period(point.period))).size > 1)) {
    feedback.push("A bar chart mixed reporting periods, which can overlap. For a bar chart choose different categories in one reporting period. For a time series use the same measurement and distinct non-overlapping periods of equal length, such as the same calendar month in different years.");
  }
  if (proposed.some(graph => graph.type === "line" && (graph.data.some(point => !date_order(point.period)) ||
      new Set(graph.data.map(point => date_order(point.period)?.grain)).size > 1 ||
      new Set(graph.data.map(point => date_order(point.period)?.time)).size !== graph.data.length))) {
    feedback.push("A line chart used incompatible, duplicate, or unparseable dates. Use one consistent date granularity and distinct actual reporting periods.");
  }
  if (reason === "review") feedback.push("The independent check did not verify the comparison or at least one labeled value. Use a simpler comparison with explicit source rows, exact intervals and units.");
  if (!feedback.length) feedback.push("Fewer than two points could be tied to exact category, unit, period and value. Choose a different directly supported set, using literal source labels and unmistakable row and column meanings.");
  return feedback;
};

const sourced_category_chart = (raw: string, evidence: TEvidence[]): TGraphDraft | undefined => {
  if (!/<(?:graph\b)|\\u003cgraph\b/iu.test(raw)) return;
  const proposed_units = [...raw.matchAll(/"unit"\s*:\s*"([^"\\]+)"/gu)].map(match => match[1]);
  const candidates = evidence.flatMap(record => {
    if (record.origin === "host") return [];
    const legend = unit_legend(record);
    const table = legend && fiscal_table(record.passage, legend);
    if (!table || table.columns.some(period => !date_order(period))) return [];
    const index = table.columns.reduce((newest, period, i) => date_order(period)!.time > date_order(table.columns[newest])!.time ? i : newest, 0);
    const period = table.columns[index];
    const groups = new Map<string, typeof table.rows>();
    for (const row of table.rows) {
      if (/^(?:grand\s+)?total\b|^sub[- ]?total\b/iu.test(row.label)) continue;
      const group = groups.get(row.marker) ?? [];
      group.push(row);
      groups.set(row.marker, group);
    }
    return [...groups.values()].flatMap(rows => {
      const unit = rows[0].unit.replace(/^\s*(?:quantity|values?)\s+in\s+/iu, "").trim();
      if (rows.length < 2 || rows.length !== new Set(rows.map(row => normalize(row.label))).size) return [];
      const data = rows.slice(0, 6).map(row => ({ label: row.label, value: row.values[index], unit, period, evidence_id: record.id, excerpt: row.excerpt }));
      const graph = graph_schema.safeParse({ name: "Reported values by category", description: `Selected source categories in ${unit} for ${period}.`, type: "bar", data });
      if (!graph.success) return [];
      const score = data.length + (proposed_units.some(value => unit_key(value) === unit_key(unit)) ? 10 : 0) +
        Math.min([...raw.matchAll(new RegExp(`"${regex_escape(record.id)}"`, "gu"))].length, 6);
      return [{ graph: graph.data, score }];
    });
  });
  return candidates.sort((a, b) => b.score - a.score)[0]?.graph;
};

export const verify_graph_document = async (raw: string, evidence: TEvidence[], verify: TGraphVerifier | undefined, signal: AbortSignal,
  repair?: TGraphRepair, on_repair?: () => void) => {
  if (!verify || !raw.trim() || signal.aborted) return empty_graphs();
  const proposed = graphs_in(raw);
  const checked = await graph_result(proposed, evidence, verify, signal);
  if (signal.aborted || checked.reason === "accepted" || checked.reason === "unavailable") return checked.output;
  const grounded = sourced_category_chart(raw, evidence);
  if (grounded) {
    on_repair?.();
    return (await graph_result([grounded], evidence, verify, signal)).output;
  }
  if (!repair) return checked.output;
  const eligible = chart_repair_evidence(evidence, proposed);
  if (!eligible.length) return checked.output;
  on_repair?.();
  try {
    const repaired = await repair({ feedback: chart_repair_feedback(proposed, checked.reason), evidence: eligible,
      rejected: proposed.map(graph => ({ name: graph.name, type: graph.type, labels: graph.data.map(point => point.label),
        periods: graph.data.map(point => point.period) })) }, AbortSignal.any([signal, AbortSignal.timeout(14000)]));
    if (!repaired || signal.aborted) return checked.output;
    const allowed = new Set(eligible.map(record => record.id));
    return (await graph_result(graphs_in(repaired).slice(0, 1), evidence.filter(record => allowed.has(record.id)), verify, signal)).output;
  } catch { return checked.output; }
};

export const stream_context_markdown = async (res: Response, markdown: string) => {
  res.vary("Accept").set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "private, no-store, no-transform", "X-Accel-Buffering": "no" });
  const abort = new AbortController();
  res.once("close", () => abort.abort());
  res.flushHeaders();
  for (const part of markdown.split(/(<graph>[^\n]*?<\/graph>)/gu)) {
    const chunks = part.startsWith("<graph>") ? [part] : part.match(/[\s\S]{1,1800}/gu) ?? [];
    for (const text of chunks) {
      if (abort.signal.aborted) return;
      if (res.write(`event: delta\ndata: ${JSON.stringify({ text })}\n\n`)) continue;
      try { await once(res, "drain", { signal: abort.signal }); }
      catch { return; }
    }
  }
  if (!abort.signal.aborted) res.end("event: done\ndata: {}\n\n");
};
