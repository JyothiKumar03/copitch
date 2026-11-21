import type { TPitchChart, TPitchChartPoint } from "@/types/pitch-artifact";
import type { TResearchSession } from "@/types/research";
import { request } from "./research";

export const fetchPitchMarkdown = async (session: TResearchSession, researchId: string, signal: AbortSignal) => {
  const url = `/api/sessions/${encodeURIComponent(session.session_id)}/research/${encodeURIComponent(researchId)}/pitch.md`;
  return (await request(url, session, undefined, { signal })).text();
};

export const downloadPitchMarkdown = (markdown: string) => {
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "pitch.md";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const validPoint = (point: unknown): point is TPitchChartPoint =>
  typeof point === "object" && point !== null &&
  "label" in point && typeof point.label === "string" && !!point.label.trim() &&
  "value" in point && (point.value === null || typeof point.value === "number" && Number.isFinite(point.value)) &&
  "unit" in point && typeof point.unit === "string" &&
  "evidence_id" in point && typeof point.evidence_id === "string" && !!point.evidence_id.trim() &&
  (!("numerator" in point) || Number.isSafeInteger(point.numerator)) &&
  (!("denominator" in point) || Number.isSafeInteger(point.denominator));

export const readPitchChart = (source: string): TPitchChart | null => {
  if (source.length > 64_000) return null;
  try {
    const spec: unknown = JSON.parse(source);
    if (typeof spec !== "object" || !spec ||
      !("type" in spec) || (spec.type !== "bar" && spec.type !== "line") ||
      !("name" in spec) || typeof spec.name !== "string" || !spec.name.trim() ||
      !("description" in spec) || typeof spec.description !== "string" ||
      !("data" in spec) || !Array.isArray(spec.data) || !spec.data.length ||
      spec.data.length > 64 || !spec.data.every(validPoint)) return null;
    const unit = spec.data[0].unit;
    if (!spec.data.every(point => point.unit === unit)) return null;
    return { type: spec.type, name: spec.name, description: spec.description, data: spec.data };
  } catch {
    return null;
  }
};
