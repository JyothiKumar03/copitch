import { pitch_markdown } from "./pitch-markdown";
import { selected_chart } from "./pitch-chart";
import { source_evidence } from "./source";
import { conversion_evidence } from "./conversion-metrics";
import type { TUploadedSource } from "../types/source";
import { source_extracts, verify_draft } from "./research-grounding";
import type { TRecordActivity, TResearchCheckpoint } from "../types/research-job";
import { isIP } from "node:net";
import type { TGrounding, TEvidence, TResearchBrief, TResearchBundle, TResearchDraft, TResearchProvider } from "../types/research";

export const public_url = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    const host = url.hostname;
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password ||
        !host.includes(".") || isIP(host) || /\.(?:localhost|local|internal|test|invalid)$/i.test(host)) return;
    url.hash = "";
    return url.href;
  } catch { return; }
};

const safe_text = (value: string) => {
  return value.replace(/[\r\n]+/g, " ").replace(/([\\\x60*_{}[\]<>#!|])/g, "\\$1").trim();
};

const evidence_from_brief = (brief: TResearchBrief, sources: TUploadedSource[]): TEvidence[] => {
  const evidence: TEvidence[] = brief.messages.map((passage, i) => ({
    id: "H" + (i+1), passage, origin: "host", location: "Host message " + (i+1),
  }));
  // Keep contiguous source passages with their offsets, including long single-line extracts.
  for (let offset = 0; offset < brief.materials.length; offset += 1800) {
    evidence.push({ id: "M" + (offset / 1800 + 1), passage: brief.materials.slice(offset, offset+1800),
      origin: "material", location: `Supplied material, characters ${offset+1}–${Math.min(brief.materials.length, offset+1800)}` });
  }
  const records = sources.flatMap(source_evidence);
  return [...evidence, ...records, ...conversion_evidence(records)];
};

const render_report = (brief: TResearchBrief, draft: TResearchDraft, evidence: TEvidence[], gaps: Set<string>) => {
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
};

export const build_research = async (
  brief: TResearchBrief, provider: TResearchProvider, signal: AbortSignal, check_current: () => void,
  previous?: TResearchCheckpoint, checkpoint?: (state: TResearchCheckpoint) => void, sources: TUploadedSource[] = [], activity?: TRecordActivity,
): Promise<TResearchBundle> => {
  const evidence = previous?.evidence ?? evidence_from_brief(brief,sources);
  const gaps = new Set(previous?.gaps ?? sources.flatMap(s => s.gaps.map(gap => s.filename + ": " + gap)));
  let completed_lookups = previous?.completed_lookups ?? 0;
  if (brief.source_policy === "files_only") {
    for (const url of brief.urls) gaps.add("Files-only policy kept this host URL unopened: " + url);
  } else {
    const page_query = brief.public_queries.join("\n") || "Retrieve supported findings from this requested page";
    const tasks = [
      ...brief.urls.map(url => ({ query: page_query, url })),
      ...brief.public_queries.map(query => ({ query, url: undefined })),
    ];
    for (const [index, task] of tasks.entries()) {
      if (index < completed_lookups) continue;
      check_current();
      if (index >= 3 || signal.aborted) {
        gaps.add("Lookup budget exhausted before researching " + (task.url ?? task.query));
        continue;
      }
      const before = evidence.length;
      activity?.("lookup_requested", task.url ? "Requested a lookup of a host-approved page." : "Requested a reviewed public search.");
      try {
        const hits = await provider.lookup(task.query, task.url, AbortSignal.any([signal, AbortSignal.timeout(20000)]), action => {
          if (action === "search") activity?.("search_completed","The provider completed a public search.");
          else if (action === "failed") activity?.("lookup_failed","The provider reported a failed web tool call.");
          else activity?.("page_opened",action === "open" ? "The provider opened a public page." : "The provider searched within a public page.");
        });
        let matched = false;
        for (const hit of hits.slice(0,8)) {
          const url = public_url(hit.url);
          if (!url || !hit.passage.trim() || (task.url && url !== task.url)) continue;
          matched = true;
          if (evidence.some(item => item.url === url && item.passage === hit.passage)) continue;
          evidence.push({ id: "P" + (evidence.length + 1), origin: "public", location: hit.title, url, passage: hit.passage });
        }
        if (!matched) {
          activity?.("lookup_empty","No matching cited material was returned.");
          gaps.add("No citation-backed result for " + (task.url ?? task.query));
        }
      } catch {
        check_current();
        activity?.("lookup_failed","The public lookup did not finish.");
        gaps.add("Lookup unavailable for " + (task.url ?? task.query));
      }
      completed_lookups = index + 1;
      checkpoint?.({ completed_lookups, evidence, gaps: [...gaps] });
      if (evidence.length > before) activity?.("sources_saved", `Saved ${evidence.length-before} new cited source records.`);
    }
  }
  check_current();
  let draft: TResearchDraft | undefined = previous?.draft;
  let grounding: TGrounding | undefined = previous?.grounding;
  if (!draft) {
    activity?.("draft_started","Requested a draft using the collected material.");
    try {
      draft = await provider.draft(brief.summary, evidence, [...gaps], signal);
    } catch {
      gaps.add("Narrative synthesis did not finish.");
    }
    check_current();
    if (draft) checkpoint?.({ completed_lookups, evidence, gaps: [...gaps], draft });
  }
  if (!draft || grounding?.version !== 1) {
    if (draft) {
      const { findings } = render_report(brief, draft, evidence, gaps);
      const pitch_script = draft.pitch_script ?? [];
      const by_id = new Map(evidence.map(item => [item.id, item]));
      const complete_script = pitch_script.length >= 3 && pitch_script.length <= 6 &&
        pitch_script[0].purpose === "opening" && pitch_script.at(-1)?.purpose === "close" &&
        pitch_script.slice(1, -1).every(passage => passage.purpose === "point") &&
        pitch_script.every(passage => passage.prose.trim() && passage.prose.length <= 1800 &&
          passage.support.length && passage.support.every(ref =>
            ref.excerpt.trim() && by_id.get(ref.evidence_id)?.passage.includes(ref.excerpt)));
      draft = { ...findings, gaps: draft.gaps, pitch_chart: selected_chart(draft.pitch_chart,evidence) ? draft.pitch_chart : null, pitch_script: complete_script ? pitch_script : undefined };
    }
    const verdict = draft && await verify_draft(draft, evidence, [...gaps], provider, signal,
      () => activity?.("verification_started","Requested an independent check of the draft against its evidence."));
    check_current();
    const selection = draft?.pitch_chart;
    const approved_chart = verdict?.chart && selection ? selection : null;
    const accepted = verdict?.prose === true;
    if (!accepted) {
      draft = source_extracts(evidence, draft);
      gaps.add("Independent prose verification was incomplete or rejected a finding. The speaking content uses eligible source extracts.");
    }
    if (draft) draft.pitch_chart = approved_chart;
    grounding = { version:1, mode:accepted ? "verified" : "source_extracts",
      ...(selection ? {chart:approved_chart ? "verified" : "withheld"} : {}) };
    if (selection && !approved_chart) gaps.add("The proposed chart did not pass independent verification and was withheld.");
    checkpoint?.({ completed_lookups, evidence, gaps: [...gaps], draft, grounding });
    if (accepted) activity?.("verified","The independent check accepted the draft.");
    else activity?.("fallback","The draft could not be verified. Switched to eligible source extracts.");
  }
  check_current();
  if (!draft) throw new Error("Missing grounded research draft");
  for (const gap of draft.gaps) if (gap.trim()) gaps.add(gap);
  const { markdown, findings } = render_report(brief, draft, evidence, gaps);
  const bundle: TResearchBundle = { research_id: crypto.randomUUID(), brief_id: brief.brief_id, confirmed_brief: brief,
    markdown, findings, pitch_chart: draft.pitch_chart ?? null, pitch_script: draft.pitch_script, grounding, evidence, gaps: [...gaps] };
  bundle.pitch_markdown = pitch_markdown(bundle);
  return bundle;
};
