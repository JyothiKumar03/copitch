import type { TResearchBundle } from "../types/research";
import { quotes } from "./excerpt";
import { serialize_research_graphs } from "./research-graphs";

const plain = (value: string) => value.replace(/\s+/gu, " ").trim()
  .replace(/([\\`*_{}[\]#!|~])/g, "\\$1")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const footnote = (id: string) => "[^" + id + "]";

const source_label = (location: string, value?: string) => {
  const label = plain(location);
  if (value) {
    try {
      const url = new URL(value);
      if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) {
        return "[" + label + "](<" + url.href.replace(/[<>]/g, encodeURIComponent) + ">)";
      }
    } catch { /* Use the stored source label for malformed historical URLs. */ }
  }
  return label;
};

export const context_markdown = (bundle: TResearchBundle): string | undefined => {
  if (!bundle.grounding || !bundle.findings?.sections) return;
  const evidence = new Map((bundle.evidence ?? []).filter(row => /^[A-Z]\d+$/.test(row.id)).map(row => [row.id, row]));
  const used = new Set<string>();
  const body = bundle.findings.sections.flatMap(section => {
    const rows = section.paragraphs.flatMap(paragraph => {
      if (!paragraph.prose.trim() || !paragraph.support.length ||
          !paragraph.support.every(ref => quotes(evidence.get(ref.evidence_id)?.passage, ref.excerpt))) return [];
      const ids = [...new Set(paragraph.support.map(ref => ref.evidence_id))]
        .filter(id => evidence.get(id)?.origin !== "host");
      for (const id of ids) used.add(id);
      return [plain(paragraph.prose) + (ids.length ? " " + ids.map(footnote).join(" ") : ""), ""];
    });
    return rows.length ? ["## " + plain(section.heading), "", ...rows] : [];
  });
  if (!body.length) return;
  const lines = ["# " + plain(bundle.findings.title || "Research context"), "", ...body];
  const graphs = serialize_research_graphs(bundle);
  if (graphs.graph_count && graphs.evidence_ids.length &&
      graphs.evidence_ids.every(id => evidence.has(id) && evidence.get(id)?.origin !== "host")) {
    lines.push(graphs.markdown.trim(), "");
    for (const id of graphs.evidence_ids) used.add(id);
  }
  if (bundle.gaps?.length) lines.push("## Evidence gaps", "", ...bundle.gaps.map(gap => "- " + plain(gap)), "");
  if (used.size) lines.push("## Sources", "");
  for (const id of used) {
    const row = evidence.get(id)!;
    const contributors = (row.derived_from ?? []).filter(source_id =>
      source_id !== id && evidence.has(source_id) && evidence.get(source_id)?.origin !== "host");
    for (const source_id of contributors) used.add(source_id);
    const detail = contributors.length ? " Based on " + contributors.map(footnote).join(" ") + "." : "";
    lines.push(footnote(id) + ": " + source_label(row.location, row.url) + " (" + row.origin + ")." + detail);
  }
  return lines.join("\n").trimEnd() + "\n";
};
