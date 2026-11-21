import { createHash } from "node:crypto";
import type { TEvidence } from "../types/research";
import type { TConversionChart } from "../types/deck";

type TCountGroup = { source_id: string; month: string | null; segment: string | null; rows: TEvidence[] };

export const conversion_evidence = (evidence: TEvidence[]): TEvidence[] => {
  const groups = new Map<string, TCountGroup>();
  for (const row of evidence) {
    const metric = row.metric;
    if (!row.source_id || !metric || row.derived_from || row.origin !== "material") continue;
    if (metric.segment && /^(overall|all|total|grand total)$/i.test(metric.segment.trim())) continue;
    for (const segment of new Set([null, metric.segment])) {
      const key = JSON.stringify([row.source_id, metric.month, segment?.toLowerCase() ?? null]);
      const group = groups.get(key) ?? { source_id: row.source_id, month: metric.month, segment, rows: [] };
      group.rows.push(row);
      groups.set(key, group);
    }
  }
  const totals: TEvidence[] = [];
  for (const [key, group] of groups) {
    const numerator = group.rows.reduce((sum, row) => sum + row.metric!.numerator, 0);
    const denominator = group.rows.reduce((sum, row) => sum + row.metric!.denominator, 0);
    if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) continue;
    const ratio = denominator > 0 ? numerator / denominator : null;
    const rate = ratio === null ? "unavailable (zero trials)" : new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 2 }).format(ratio);
    const first = group.rows[0].location;
    const last = group.rows.at(-1)!.location;
    totals.push({ id: "C" + parseInt(createHash("sha256").update(key).digest("hex").slice(0, 12), 16),
      origin: "material", source_id: group.source_id,
      location: group.rows.length === 1 ? first : `${group.rows.length} contributing rows from ${first} through ${last}`,
      passage: `${group.segment ?? "Overall"}${group.month ? " in " + group.month : ""}: ${numerator} conversions from ${denominator} trials. Conversion rate: ${rate}.`,
      metric: { month: group.month, segment: group.segment, numerator, denominator, ratio },
      derived_from: group.rows.map(row => row.id) });
  }
  return totals;
};

export const chart_for_findings = (ids: Set<string>, evidence: TEvidence[]): TConversionChart | undefined => {
  const cited = evidence.find(row => ids.has(row.id) && row.metric && row.source_id);
  if (!cited?.metric) return;
  const totals = evidence.filter(row => row.derived_from && row.metric && row.source_id === cited.source_id && row.metric.month === cited.metric!.month);
  const overall = totals.find(row => row.metric!.segment === null);
  if (!overall) return;
  const segments = totals.filter(row => row.metric!.segment !== null).sort((a, b) =>
    Number(ids.has(b.id) || b.derived_from!.some(id => ids.has(id))) - Number(ids.has(a.id) || a.derived_from!.some(id => ids.has(id))));
  const rows = [overall, ...segments.slice(0, 3)].map(row => ({
    label: row.metric!.segment ?? "Overall", numerator: row.metric!.numerator,
    denominator: row.metric!.denominator, evidence_id: row.id,
  }));
  return { period: cited.metric.month, rows };
};
