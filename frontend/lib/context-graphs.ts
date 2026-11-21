import type { TContextPreview } from "@/types/pitch-artifact";
import type { TResearchGraph, TResearchGraphPoint } from "../../shared/research-graphs";

const open = "<graph>";
const close = "</graph>";
const maxGraphLength = 32_768;
export const graphPlaceholder = "copitch-context-graph";

const validText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max && !!value.trim() && !/[<>\u0000-\u001f\u007f]/u.test(value);

const readPoint = (value: unknown): TResearchGraphPoint | null => {
  if (!value || typeof value !== "object") return null;
  const point = value as Record<string, unknown>;
  const { label, value: number, unit, period, evidence_id } = point;
  if (!validText(label, 100) || typeof number !== "number" || !Number.isFinite(number) || Math.abs(number) > 1e15 || !validText(unit, 32) ||
      !validText(period, 64) || typeof evidence_id !== "string" || !/^[A-Z]\d+$/u.test(evidence_id)) return null;
  return { label, value: number, unit, period, evidence_id };
};

const readGraph = (source: string): TResearchGraph | null => {
  if (source.length > maxGraphLength) return null;
  try {
    const spec = JSON.parse(source) as Record<string, unknown> | null;
    if (!spec) return null;
    const { type, name, description, data } = spec;
    if ((type !== "bar" && type !== "line") || !validText(name, 120) || !validText(description, 300) ||
        !Array.isArray(data) || data.length < 2 || data.length > 12) return null;
    const points = data.map(readPoint).filter((point): point is TResearchGraphPoint => point !== null);
    if (points.length !== data.length || points.some(point => point.unit !== points[0].unit)) return null;
    if (new Set(points.map(point => point.label.toLowerCase())).size !== points.length) return null;
    if (type === "bar" && points.some(point => point.period !== points[0].period)) return null;
    if (type === "line" && new Set(points.map(point => point.period.toLowerCase())).size !== points.length) return null;
    return { type, name, description, data: points };
  } catch { return null; }
};

const tailLength = (text: string, marker: string) => {
  for (let length = Math.min(text.length, marker.length - 1); length > 0; length--) {
    if (text.endsWith(marker.slice(0, length))) return length;
  }
  return 0;
};

export const createContextGraphDecoder = () => {
  let markdown = "";
  let pending = "";
  let graph: string | null = null;
  let discarding = false;
  let fence: string | undefined;
  let rejectedGraphs = 0;
  const graphs = new Map<number, TResearchGraph>();

  const push = (chunk: string) => {
    pending += chunk;
    while (pending) {
      if (graph !== null || discarding) {
        const end = pending.indexOf(close);
        const keep = end < 0 ? tailLength(pending, close) : 0;
        const stop = end < 0 ? pending.length - keep : end;
        if (graph !== null) {
          if (graph.length + stop <= maxGraphLength) graph += pending.slice(0, stop);
          else { graph = null; discarding = true; }
        }
        pending = pending.slice(end < 0 ? stop : end + close.length);
        if (end < 0) break;
        const chart = graph !== null && graphs.size < 3 ? readGraph(graph) : null;
        if (chart) {
          markdown += "\n\n";
          graphs.set(markdown.length, chart);
          markdown += `\x60\x60\x60${graphPlaceholder}\n\x60\x60\x60\n\n`;
        } else rejectedGraphs++;
        graph = null;
        discarding = false;
        continue;
      }
      if (!fence && pending.startsWith(open)) {
        graph = "";
        pending = pending.slice(open.length);
        continue;
      }
      const end = pending.indexOf("\n");
      if (end < 0) break;
      const line = pending.slice(0, end);
      const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
      if (marker && !fence) fence = marker;
      else if (marker && fence?.[0] === marker[0] && marker.length >= fence.length && /^ {0,3}(?:`+|~+)\s*$/u.test(line)) fence = undefined;
      markdown += pending.slice(0, end + 1);
      pending = pending.slice(end + 1);
    }
  };

  const preview = (complete = false): TContextPreview => {
    const partialOpen = !fence && !!pending && open.startsWith(pending);
    const unfinished = graph !== null || discarding || partialOpen;
    return { markdown: markdown + (unfinished ? "" : pending), graphs: new Map(graphs), rejectedGraphs: rejectedGraphs + (complete && unfinished ? 1 : 0) };
  };
  return { push, preview };
};

export const decodeContextGraphs = (markdown: string): TContextPreview => {
  const decoder = createContextGraphDecoder();
  decoder.push(markdown);
  return decoder.preview(true);
};
