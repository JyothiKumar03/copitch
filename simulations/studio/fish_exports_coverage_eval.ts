import { is_context_document, read_cited_pitch } from "./pitch_coverage_eval";

// Dates, values and units verified against the first USD export table and the MPEDA item-wise table.
export const revised_estimates_url = "https://www.commerce.gov.in/files/d-m-y/Revised-Quick-Estimates-October-2026.pdf";
export const mpeda_exports_url = "https://mpeda.gov.in/?page_id=438";
const expected = { october: "1022.77", april_october: "5523.2" } as const;
const main_category = /\b(?:marine products?|seafood)\b/u;
const fiscal_year = /\b2025\s*(?:-|to)\s*(?:20)?26\b/u;
const local_units = (value: string) => new RegExp(`(?:₹|rs\\.?\\s*|inr\\s*)${value}\\s+crore\\b`, "u");
const tonnes = (value: string) => new RegExp(`(?<![\\d.,])${value}\\s*(?:m\\.?\\s*t\\.?|metric ton(?:ne)?s?|tonnes)\\b`, "u");
const usd = (value: string, unit = "(?:million|mn|m)") => new RegExp(`(?:(?:us\\s*\\$|\\$|usd)\\s*${value}\\s*${unit}\\b|${value}\\s*${unit}\\s*(?:us\\s*\\$|u\\.?s\\.? dollars?|usd)\\b)`, "u");
const usd_trade_row = /(?:(?:us\s*\$|\$|usd)\s*(1[,]?022\.77|5[,]?523\.20?)\s*(?:million|mn|m)\b|(1[,]?022\.77|5[,]?523\.20?)\s*(?:million|mn|m)\s*(?:u\.?s\.? dollars?|usd)\b)/gu;
const sentence_splitter = new Intl.Segmenter("en", { granularity: "sentence" });

const provenance = (input: string | undefined) => {
  try {
    const url = new URL(input ?? "");
    if (url.protocol !== "https:" || url.username || url.password || url.port) return;
    const host = url.hostname.replace(/^www\./u, "");
    if (host === "commerce.gov.in" && /quick-estimates-october(?:-|%20)2026\.pdf$/iu.test(url.pathname)) return "october_table";
    if (host === "mpeda.gov.in" || host === "pib.gov.in") return "fiscal_data";
  } catch { /* Treat malformed source definitions as missing. */ }
};

type TTradePeriod = keyof typeof expected | "calendar_to_october";

const period_values = (text: string) => {
  const marked = text
    // The name of a publication is distinct from the period of a figure it contains.
    .replace(/\boct(?:ober)?\s+2026\s+(?:revised\s+)?quick estimates\b/gu, "quick estimates")
    .replace(/\bquick estimates\s+(?:for\s+)?oct(?:ober)?\s+2026\b/gu, "quick estimates")
    .replace(/\bjan(?:uary)?(?:\s+2026)?\s*(?:-|through|to|and)\s*oct(?:ober)?\s+2026\b/gu, "@calendar_to_october@")
    .replace(/\bapr(?:il)?(?:\s*(?:2026|'26))?\s*(?:-|through|to|and)\s*oct(?:ober)?\s*(?:2026|'26)\b/gu, "@april_october@")
    .replace(/\boct(?:ober)?\s*(?:2026|'26)\b/gu, "@october@");
  const labels = (text: string) => [...text.matchAll(/@(calendar_to_october|april_october|october)@/gu)].map(match => match[1] as TTradePeriod);
  const values = (text: string) => [...text.matchAll(usd_trade_row)].map(match => String(Number((match[1] ?? match[2]).replace(/,/gu, ""))));
  return [...sentence_splitter.segment(marked)].flatMap(({ segment }) => {
    const periods = labels(segment);
    const amounts = values(segment);
    if (periods.length > 1 && periods.length === amounts.length && /\brespectively\b/u.test(segment)) {
      return periods.map((period, index) => ({ period, amount: amounts[index] }));
    }
    return segment.split(/;|,\s+(?=(?:with|while|whereas|compared)\b)|\s+(?:and|while|whereas|compared with|versus)\s+/u).flatMap(clause => {
      const periods = labels(clause);
      const amounts = values(clause);
      return periods.length === 1 && amounts.length === 1 ? [{ period: periods[0], amount: amounts[0] }] : [];
    });
  });
};

export const score_fish_exports = (markdown: string, require_october_table = false, context = false) => {
  const { claims, sources } = read_cited_pitch(markdown);
  const from = (group: ReturnType<typeof provenance>) => claims.filter(claim => claim.section !== "talk track" &&
    claim.citations.some(id => provenance(sources.get(id)) === group));
  const fiscal = from("fiscal_data");
  const frozen_fish = (value: RegExp) => fiscal.some(({ text }) => /\bfrozen fish\b/u.test(text) && value.test(text) && !period_values(text).length);
  const marine_rows = from("october_table").flatMap(({ text, section }) => main_category.test(text + " " + section) ? period_values(text) : []);
  // Include the talk track when checking for contradictions, even if the brief has the correct values.
  const all_pairs = claims.flatMap(({ text, section }) => main_category.test(text + " " + section) ? period_values(text) : []);
  const october_value = marine_rows.some(row => row.period === "october" && row.amount === expected.october);
  const april_october_value = marine_rows.some(row => row.period === "april_october" && row.amount === expected.april_october);
  const period_swap = all_pairs.some(({ period, amount }) => period === "calendar_to_october" || expected[period] !== amount);
  const checks = {
    fiscal_period: fiscal.some(({ text }) => fiscal_year.test(text)),
    calendar_distinguished: /calendar|year.to.date|January/iu.test(markdown),
    total_seafood_value: fiscal.some(({ text }) => main_category.test(text) &&
      (!/\bfrozen fish\b/u.test(text) || /\btotal seafood\b/u.test(text)) &&
      (local_units("73[,]?890\\.46").test(text) || usd("8[,]?455\\.76").test(text) || usd("8\\.46", "billion").test(text))),
    total_seafood_volume: fiscal.some(({ text }) => main_category.test(text) && tonnes("(?:19,72,018|1,972,018|1972018)").test(text)) &&
      !claims.some(({ text }) => main_category.test(text) && tonnes("19\\.72\\s+million").test(text)),
    frozen_fish_value: frozen_fish(usd("643\\.70?")),
    frozen_fish_volume: frozen_fish(tonnes("(?:3,55,581|355[,]?581)")),
    shrimp_distinguished: fiscal.some(({ text }) => /\bfrozen shrimp\b/u.test(text) &&
      (tonnes("(?:7,92,647|792[,]?647)").test(text) || usd("5[,]?624\\.48").test(text) || local_units("49[,]?037\\.93").test(text))),
    ...(context ? { standalone_context: is_context_document(markdown) } : {
      has_talk_track: claims.some(claim => claim.section === "talk track" && claim.citations.some(id => !!provenance(sources.get(id)))),
    }),
    periods_consistent: !period_swap,
  };
  const has_graph = [...markdown.matchAll(/<graph>([^]*?)<\/graph>/gu)].some(match => {
    try {
      const graph = JSON.parse(match[1]);
      return ["bar", "line"].includes(graph?.type) && graph?.data?.length >= 2 && graph.data.every((point: { value?: unknown; evidence_id?: unknown }) =>
        Number.isFinite(point.value) && typeof point.evidence_id === "string" && Boolean(provenance(sources.get(point.evidence_id))));
    } catch { return false; }
  });
  return { passed: Object.values(checks).every(Boolean) && (!require_october_table || october_value && april_october_value && (!context || has_graph)),
    ...checks, requires_october_table: require_october_table, october_value, april_october_value, has_graph };
};
