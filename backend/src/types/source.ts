import type { source_formats } from "../constants/sources";

export type TSourceKind = keyof typeof source_formats;
export type TParserCall = {
  call_id: string;
  filename: string;
  tool: (typeof source_formats)[TSourceKind]["tool"];
  status: "running" | "succeeded" | "failed";
  started_at: string;
  finished_at: string | null;
  source: TSourceSummary | null;
  error: string | null;
};
export type TSourceSummary = { source_id: string; filename: string; kind: TSourceKind; locations: number };
export type TConversionMetric = {
  month: string | null; segment: string | null; numerator: number; denominator: number; ratio: number | null;
};
export type TCsvObservation = {
  column: number; measure: string; axis: string; label: string; date: number | null; value: number; unit: string;
};
export type TSourceRecord = { number: number; text: string; metric?: TConversionMetric; numeric_series?: TCsvObservation[] };
export type TSourceContent = { records: TSourceRecord[]; gaps: string[] };
export type TUploadedSource = TSourceSummary & TSourceContent;
