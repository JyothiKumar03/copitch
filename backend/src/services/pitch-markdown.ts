import { artifact_chart } from "./pitch-chart";
import { pitch_content } from "./pitch-content";
import type { TResearchBundle } from "../types/research";

const plain = (value: string) => value.replace(/\s+/gu," ").trim().replace(/([\\`*_{}[\]<>#!|~])/g,"\\$1");
const footnote = (id: string) => "[^" + id + "]";

export const pitch_markdown = (bundle: TResearchBundle): string => {
  if (!bundle.grounding) return "# Pitch\n\nThis saved research predates pitch verification. Review the original memo or refine the brief to generate a verified pitch.\n";
  const content = pitch_content(bundle);
  const evidence = new Map((bundle.evidence ?? []).filter(e => /^[A-Z]\d+$/.test(e.id)).map(e => [e.id,e]));
  const used = new Set<string>();
  const lines = ["# " + plain(content.title), "", content.format === "script" ? "Pitch script" : "Source-backed talking points", ""];
  for (const passage of content.passages) {
    if (!passage.evidence_ids.length || !passage.evidence_ids.every(id => evidence.has(id))) continue;
    lines.push("## " + plain(passage.label),"",plain(passage.text) + " " + passage.evidence_ids.map(footnote).join(" "), "");
    for (const id of passage.evidence_ids) used.add(id);
  }
  if (!used.size) lines.push("There are no verified talking points for this scope. Add supporting material and refine the brief.","");
  const chart = artifact_chart(bundle,used);
  if (chart && chart.data.every(item => evidence.has(item.evidence_id))) {
    const chart_ids = [...new Set(chart.data.map(item => item.evidence_id))];
    const json = JSON.stringify(chart,null,2).replaceAll("`","\\u0060").replaceAll("<","\\u003c").replaceAll(">","\\u003e");
    lines.push("## " + plain(chart.name),"","\x60\x60\x60recharts",json,"\x60\x60\x60","", "Chart sources " + chart_ids.map(footnote).join(" "), "");
    for (const id of chart_ids) used.add(id);
  }
  if (content.gaps.length) lines.push("## Evidence gaps","",...content.gaps.map(g => "- " + plain(g)),"");
  if (used.size) lines.push("## Sources","");
  for (const id of used) {
    const row = evidence.get(id)!;
    const label = plain(row.location);
    let location = label;
    if (row.url) {
      try {
        const url = new URL(row.url);
        if (["http:","https:"].includes(url.protocol) && !url.username && !url.password) {
          location = "[" + label + "](<" + url.href.replace(/[<>]/g,encodeURIComponent) + ">)";
        }
      } catch { /* A saved reference with a malformed URL still has a source locator. */ }
    }
    const contributors = (row.derived_from ?? []).filter(source_id => evidence.has(source_id) && source_id !== id);
    for (const source_id of contributors) used.add(source_id);
    const detail = contributors.length ? " Based on " + contributors.map(footnote).join(" ") + "." : "";
    lines.push(footnote(id) + ": " + location + " (" + row.origin + ")." + detail);
  }
  return lines.join("\n").trimEnd() + "\n";
};
