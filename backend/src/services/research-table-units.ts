import type { TEvidence } from "../types/research";

export const unit_legend = (record: TEvidence) => record.passage.split(/\r?\n/u).find(line => /\bunits?\s+for\s+all\b/iu.test(line));

export const mark_units = (legend: string) => [...legend.matchAll(/(?:^|\s|,)([\p{L}\p{Sc}%]{1,3})\s*:\s*([^,\n:]+)/gu)]
  .map(match => ({ marker: match[1].toLowerCase(), text: match[2] }));
