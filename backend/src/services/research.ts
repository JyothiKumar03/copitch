import { isIP } from "node:net";
import type { TEvidence, TResearchBrief, TResearchBundle, TResearchDraft, TResearchProvider } from "../types/research";

export function public_url(value: string): string | undefined {
  try {
    const url = new URL(value);
    const host = url.hostname;
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password ||
        !host.includes(".") || isIP(host) || /\.(?:localhost|local|internal|test|invalid)$/i.test(host)) return;
    url.hash = "";
    return url.href;
  } catch { return; }
}

function safe_text(value: string) {
  return value.replace(/[\r\n]+/g, " ").replace(/([\\\x60*_{}[\]<>#!|])/g, "\\$1").trim();
}

function evidence_from_brief(brief: TResearchBrief): TEvidence[] {
  const evidence: TEvidence[] = brief.messages.map((passage, i) => ({
    id: "H" + (i+1), passage, origin: "host", location: "Host message " + (i+1),
  }));
  // Keep contiguous source passages with their offsets, including long single-line extracts.
  for (let offset = 0; offset < brief.materials.length; offset += 1800) {
    evidence.push({ id: "M" + (offset / 1800 + 1), passage: brief.materials.slice(offset, offset+1800),
      origin: "material", location: `Supplied material, characters ${offset+1}–${Math.min(brief.materials.length, offset+1800)}` });
  }
  return evidence;
}

function render_report(brief: TResearchBrief, draft: TResearchDraft, evidence: TEvidence[], gaps: Set<string>) {
  const by_id = new Map(evidence.map(item => [item.id, item]));
  const used = new Map<string, Set<string>>();
  const lines = ["# " + safe_text(draft.title || "Research report"), "", "## Confirmed scope", "", safe_text(brief.summary), ""];
  const sections: TResearchDraft["sections"] = [];
  for (const section of draft.sections) {
    const paragraphs: string[] = [];
    const supported: typeof section.paragraphs = [];
    for (const paragraph of section.paragraphs) {
      const valid = paragraph.prose.trim() && paragraph.support.length && paragraph.support.every(ref =>
        ref.excerpt.trim() && by_id.get(ref.evidence_id)?.passage.includes(ref.excerpt));
      if (!valid) {
        gaps.add("A proposed finding lacked a traceable supporting passage and was withheld.");
        continue;
      }
      const ids = new Set<string>();
      for (const ref of paragraph.support) {
        ids.add(ref.evidence_id);
        const excerpts = used.get(ref.evidence_id) ?? new Set<string>();
        excerpts.add(ref.excerpt);
        used.set(ref.evidence_id, excerpts);
      }
      paragraphs.push(safe_text(paragraph.prose) + " " + [...ids].map(id => `[^${id}]`).join(""), "");
      supported.push(paragraph);
    }
    if (supported.length) {
      sections.push({ heading: section.heading, paragraphs: supported });
      lines.push("## " + safe_text(section.heading), "", ...paragraphs);
    }
  }
  if (!sections.length) gaps.add("No supported narrative findings were available for this scope.");
  if (gaps.size) lines.push("## Unresolved questions and retrieval gaps", "", ...[...gaps].map(gap => "- " + safe_text(gap)), "");
  if (used.size) lines.push("## Evidence", "");
  for (const [id, excerpts] of used) {
    const item = by_id.get(id)!;
    const source = item.url ? `[${safe_text(item.location)}](<${item.url.replace(/[<>]/g, encodeURIComponent)}>)` : safe_text(item.location);
    lines.push(`[^${id}]: ${source} (${item.origin}). ${[...excerpts].map(value => "“" + safe_text(value) + "”").join(" ")}`, "");
  }
  return { markdown: lines.join("\n"), findings: { title: draft.title || "Research report", sections } };
}

export async function build_research(
  brief: TResearchBrief, provider: TResearchProvider, signal: AbortSignal, check_current: () => void,
): Promise<TResearchBundle> {
  const evidence = evidence_from_brief(brief);
  const gaps = new Set<string>();
  if (brief.source_policy === "files_only") {
    for (const url of brief.urls) gaps.add("Files-only policy kept this host URL unopened: " + url);
  } else {
    const tasks = [
      ...brief.urls.map(url => ({ query: "Retrieve supported findings from this requested page", url })),
      ...brief.public_queries.map(query => ({ query, url: undefined })),
    ];
    for (const [index, task] of tasks.entries()) {
      check_current();
      if (index >= 3 || signal.aborted) {
        gaps.add("Lookup budget exhausted before researching " + (task.url ?? task.query));
        continue;
      }
      try {
        const hits = await provider.lookup(task.query, task.url, AbortSignal.any([signal, AbortSignal.timeout(20000)]));
        let matched = false;
        for (const hit of hits.slice(0,8)) {
          const url = public_url(hit.url);
          if (!url || !hit.passage.trim() || (task.url && url !== task.url)) continue;
          matched = true;
          if (evidence.some(item => item.url === url && item.passage === hit.passage)) continue;
          evidence.push({ id: "P" + (evidence.length + 1), origin: "public", location: hit.title, url, passage: hit.passage });
        }
        if (!matched) gaps.add("No citation-backed result for " + (task.url ?? task.query));
      } catch {
        gaps.add("Lookup unavailable for " + (task.url ?? task.query));
      }
    }
  }
  check_current();
  let draft: TResearchDraft;
  try {
    draft = await provider.draft(brief.summary, evidence, [...gaps], signal);
    for (const gap of draft.gaps) if (gap.trim()) gaps.add(gap);
  } catch {
    gaps.add("Narrative synthesis did not finish. The available source extracts are included for review.");
    draft = { title: "Research report", gaps: [], sections: [{ heading: "Available evidence",
      paragraphs: evidence.filter(item => item.origin !== "host").slice(0,12).map(item => {
        const excerpt = item.passage.slice(0,400);
        return { prose: excerpt, support: [{ evidence_id: item.id, excerpt }] };
      }) }] };
  }
  check_current();
  const { markdown, findings } = render_report(brief, draft, evidence, gaps);
  return { research_id: crypto.randomUUID(), brief_id: brief.brief_id, confirmed_brief: brief, markdown, findings, evidence, gaps: [...gaps] };
}
