export type TSourceKind = "pdf" | "pptx" | "csv";
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
