import { pitch_markdown } from "./pitch-markdown";
import { verify_graph_document } from "./research-graphs";
import { selected_chart } from "./pitch-chart";
import { source_evidence } from "./source";
import { conversion_evidence } from "./conversion-metrics";
import type { TUploadedSource } from "../types/source";
import { keep_supported, source_extracts, verify_draft } from "./research-grounding";
import { collect_research } from "./research-agent";
import { create_research_sources } from "./research-tools";
import { AppError } from "../errors/app-error";
import type { TRecordActivity, TResearchCheckpoint } from "../types/research-job";
import { isIP } from "node:net";
import type { TGrounding, TEvidence, TResearchBrief, TResearchBundle, TResearchDraft, TResearchProvider } from "../types/research";
import { quotes } from "./excerpt";

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

const max_voice_evidence_turns = 8;
const max_voice_evidence_chars = 12_000;
const non_evidence_intents = new Set(["approval", "greeting", "language", "meta", "scope", "status", "url_confirmation", "unsupported"]);

const evidence_from_brief = (brief: TResearchBrief, sources: TUploadedSource[]): TEvidence[] => {
  const studio = brief.studio_version === 2;
  const host_records = studio ? [...new Set((brief.studio_notes ?? []).filter(text => text.trim()))] : brief.messages;
  const evidence: TEvidence[] = host_records.map((passage, i) => ({
    id: "H" + (i+1), passage, origin: "host", location: "Host " + (studio ? "note " : "message ") + (i+1),
  }));
  if (studio) {
    const seen = new Set(host_records);
    const recent = (brief.history ?? []).filter(turn => turn.role === "host" && turn.voice_items?.length &&
      !turn.option_id && !(turn.intent && non_evidence_intents.has(turn.intent)) && turn.text.trim())
      .slice(-max_voice_evidence_turns).reverse();
    const passages: string[] = [];
    let remaining = max_voice_evidence_chars;
    for (const { text } of recent) {
      if (seen.has(text) || text.length > remaining) continue;
      seen.add(text);
      remaining -= text.length;
      passages.push(text);
    }
    for (const [index, passage] of passages.reverse().entries()) {
      evidence.push({ id: "H" + (evidence.length + 1), passage, origin: "host", location: "Host voice transcript " + (index + 1) });
    }
  }
  // Keep contiguous source passages with their offsets, including long single-line extracts.
  for (let offset = 0; offset < brief.materials.length; offset += 1800) {
    evidence.push({ id: "M" + (offset / 1800 + 1), passage: brief.materials.slice(offset, offset+1800),
      origin: "material", location: `Supplied material, characters ${offset+1}–${Math.min(brief.materials.length, offset+1800)}` });
  }
  const records = sources.flatMap(source_evidence);
  return [...evidence, ...records, ...conversion_evidence(records)];
};

const needs_more_evidence = "I couldn't find enough evidence for the research context. Share a working link, a file, or one specific example you want included.";
const paragraph_key = (prose: string) => prose.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();

const with_verified_additions = (base: TResearchDraft, revision: TResearchDraft) => {
  const seen = new Set(base.sections.flatMap(section => section.paragraphs.map(paragraph => paragraph_key(paragraph.prose))));
  const sections = base.sections.map(section => ({ ...section, paragraphs: [...section.paragraphs] }));
  for (const section of revision.sections) {
    const additions = section.paragraphs.filter(paragraph => {
      const prose = paragraph_key(paragraph.prose);
      if (seen.has(prose)) return false;
      seen.add(prose);
      return true;
    });
    if (!additions.length) continue;
    const existing = sections.find(item => item.heading.trim().toLowerCase() === section.heading.trim().toLowerCase());
    if (existing) existing.paragraphs.push(...additions);
    else sections.push({ heading: section.heading, paragraphs: additions });
  }
  return { ...base, sections, graph_xml: base.graph_xml ?? revision.graph_xml, gaps: [...new Set([...base.gaps, ...revision.gaps])] };
};

const supported_findings = (draft: TResearchDraft, evidence: TEvidence[], gaps: Set<string>): TResearchBundle["findings"] => {
  const by_id = new Map(evidence.map(item => [item.id, item]));
  const published = new Set<string>();
  const sections = draft.sections.flatMap(section => {
    const supported: typeof section.paragraphs = [];
    for (const paragraph of section.paragraphs) {
      const valid = paragraph.prose.trim() && paragraph.support.length && paragraph.support.every(ref =>
        quotes(by_id.get(ref.evidence_id)?.passage, ref.excerpt));
      if (!valid) {
        gaps.add("A proposed finding lacked a traceable supporting passage and was withheld.");
        continue;
      }
      const key = paragraph_key(paragraph.prose);
      if (published.has(key)) continue;
      published.add(key);
      supported.push(paragraph);
    }
    return supported.length ? [{ heading: section.heading, paragraphs: supported }] : [];
  });
  if (!sections.length) gaps.add("No supported narrative findings were available for this scope.");
  return { title: draft.title || "Research report", sections };
};

export const research_report = ({ confirmed_brief, findings, evidence, gaps }: TResearchBundle) => {
  const by_id = new Map(evidence.map(item => [item.id, item]));
  const used = new Map<string, Set<string>>();
  const lines = ["# " + safe_text(findings.title), "", "## Confirmed scope", "", safe_text(confirmed_brief.summary), ""];
  for (const section of findings.sections) {
    const paragraphs = section.paragraphs.flatMap(paragraph => {
      const ids = new Set<string>();
      for (const ref of paragraph.support) {
        if (!by_id.has(ref.evidence_id)) continue;
        ids.add(ref.evidence_id);
        const excerpts = used.get(ref.evidence_id) ?? new Set<string>();
        excerpts.add(ref.excerpt);
        used.set(ref.evidence_id, excerpts);
      }
      return [safe_text(paragraph.prose) + " " + [...ids].map(id => `[^${id}]`).join(""), ""];
    });
    lines.push("## " + safe_text(section.heading), "", ...paragraphs);
  }
  if (gaps.length) lines.push("## Unresolved questions and retrieval gaps", "", ...gaps.map(gap => "- " + safe_text(gap)), "");
  if (used.size) lines.push("## Evidence", "");
  for (const [id, excerpts] of used) {
    const item = by_id.get(id)!;
    const source = item.url ? `[${safe_text(item.location)}](<${item.url.replace(/[<>]/g, encodeURIComponent)}>)` : safe_text(item.location);
    lines.push(`[^${id}]: ${source} (${item.origin}). ${[...excerpts].map(value => "“" + safe_text(value) + "”").join(" ")}`, "");
  }
  return lines.join("\n");
};

// The writer needs the records behind the checked answers, then the rest up to a budget. Sending every passage from
// several long reports buries the answers in unrelated pages and overflows the writer.
const writer_evidence_chars = 90_000;
const writer_evidence = (evidence: TEvidence[], collection?: TResearchCheckpoint["collection"]) => {
  const answered = new Set(collection && "checklist" in collection ? collection.checklist.flatMap(item => item.evidence_id ?? []) : []);
  const ordered = [...evidence.filter(item => answered.has(item.id) || item.origin !== "public"),
    ...evidence.filter(item => !answered.has(item.id) && item.origin === "public")];
  const selected: TEvidence[] = [];
  let size = 0;
  for (const item of ordered) {
    size += item.passage.length + item.location.length;
    if (size > writer_evidence_chars && selected.length) break;
    selected.push(item);
  }
  return selected;
};

// One section per checked answer: the heading states the finding, the point is the answer, and its support is the
// verbatim excerpt the server already checked. Unanswered questions become listed gaps. No long-form writer call.
const min_checked_sections = 3;
const checklist_draft = (brief: TResearchBrief, collection?: TResearchCheckpoint["collection"]): TResearchDraft | undefined => {
  if (!collection || !("checklist" in collection)) return;
  const covered = collection.checklist.filter(item => item.status === "covered" && item.answer && item.evidence_id && item.excerpt);
  if (covered.length < min_checked_sections) return;
  return {
    title: brief.intent?.subject ? `${brief.intent.subject}: ${brief.intent.outcome ?? "key findings"}`.slice(0, 160) : "Key findings",
    sections: covered.map(item => ({
      heading: (item.heading ?? item.question).slice(0, 160),
      paragraphs: [{ prose: item.answer!, support: [{ evidence_id: item.evidence_id!, excerpt: item.excerpt! }] }],
    })),
    // Unanswered questions are already recorded as research gaps when collection finishes.
    gaps: [],
  };
};

export const build_research = async (
  brief: TResearchBrief, provider: TResearchProvider, signal: AbortSignal, check_current: () => void,
  previous?: TResearchCheckpoint, checkpoint?: (state: TResearchCheckpoint) => void, sources: TUploadedSource[] = [], activity?: TRecordActivity,
): Promise<TResearchBundle> => {
  const studio = brief.studio_version === 2;
  const model_step = studio ? provider.collect_step : undefined;
  // A pending pre-agent job can be rebuilt from its confirmed inputs. Published bundles are unaffected.
  if (model_step && ![2, 3, 4].includes(previous?.collection?.version ?? 0)) previous = undefined;
  let evidence = previous?.evidence ?? evidence_from_brief(brief,sources);
  const gaps = new Set(previous?.gaps ?? sources.flatMap(s => s.gaps.map(gap => s.filename + ": " + gap)));
  if (studio && !evidence.length && (brief.source_policy === "files_only" || (!brief.urls.length && !brief.public_queries.length))) {
    check_current();
    throw new AppError(422, needs_more_evidence);
  }
  if (studio && !model_step) throw new AppError(503, "The research model is unavailable. Retry research.");
  let completed_lookups = previous?.completed_lookups ?? 0;
  let collection = previous?.collection;
  if (model_step) {
    const discovery = create_research_sources(brief, provider.lookup);
    const state = await collect_research({
      brief, evidence, gaps: [...gaps],
      previous: collection && { ...collection, evidence, gaps: [...gaps], completed_lookups }, model_step, signal, check_current, activity,
      checkpoint: ({ completed_lookups, evidence, gaps, ...collection }) => checkpoint?.({ completed_lookups, evidence, gaps, collection }),
      lookup: async ({ kind, target, known_links }, lookup_signal) => {
        if (kind === "read") {
          const page = await discovery.read_page(target, known_links, lookup_signal);
          return { url: page.url, hits: page.hits, links: page.links.map(link => ({ url: link.url, title: link.label })) };
        }
        const links = await discovery.search_web(target, lookup_signal);
        return { hits: [], links: links.map(link => ({ url: link.url, title: link.label })) };
      },
    });
    const { completed_lookups: count, evidence: records, gaps: remaining, ...details } = state;
    collection = details;
    evidence = records;
    completed_lookups = count;
    for (const gap of remaining) gaps.add(gap);
  } else if (brief.source_policy === "files_only") {
    for (const url of brief.urls) gaps.add("Files-only policy kept this host URL unopened: " + url);
  } else {
    // Preserve the original research endpoint for briefs created before the studio agent.
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
        const timeout = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
        const hits = await provider.lookup(task.query, task.url, timeout, action => {
          if (action === "search") activity?.("search_completed","The provider completed a public search.");
          else if (action === "failed") activity?.("lookup_failed","The provider reported a failed web tool call.");
          else activity?.("page_opened",action === "open" ? "The provider opened a public page." : "The provider searched within a public page.");
        });
        let matched = false;
        for (const hit of hits.slice(0, 8)) {
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
  if (studio && brief.source_policy === "public_search" && (brief.urls.length || brief.public_queries.length) &&
      !evidence.some(record => record.origin === "public")) {
    throw new AppError(422, "I couldn't read any public evidence for the approved plan. Share a working source or switch to your materials only.");
  }
  if (studio && !evidence.length) throw new AppError(422, needs_more_evidence);
  let draft: TResearchDraft | undefined = previous?.draft;
  let grounding: TGrounding | undefined = previous?.grounding;
  let draft_attempts = previous?.draft_attempts ?? (draft ? 1 : 0);
  let draft_feedback = previous?.draft_feedback ?? [];
  let verified_candidate = previous?.verified_candidate;
  let built_from_checklist = false;
  const draft_limit = studio ? 2 : 1;
  const save_draft = () => checkpoint?.({ completed_lookups, evidence, gaps: [...gaps], collection, draft, grounding, draft_attempts, draft_feedback, verified_candidate });
  const restore_candidate = () => {
    if (!verified_candidate) return false;
    ({ draft, grounding } = verified_candidate);
    activity?.("verified", "Kept the verified brief after its revision could not be verified.");
    save_draft();
    return true;
  };
  while (!grounding) {
    const previous_findings = verified_candidate?.draft.sections.flatMap(section =>
      section.paragraphs.map(paragraph => section.heading + "\n" + paragraph.prose)).join("\n\n").slice(0, 10_000);
    // A resolved checklist is the brief. The long-form writer remains for briefs without one, or to repair a rejected draft.
    const answered = studio && !draft && draft_attempts === 0 && !verified_candidate ? checklist_draft(brief, collection) : undefined;
    if (answered) {
      built_from_checklist = true;
      draft = answered;
      draft_attempts = 1;
      activity?.("draft_started", `Built the brief from ${answered.sections.length} checked answers.`);
      save_draft();
    } else if (!draft && draft_attempts < draft_limit) {
      const repairing = draft_attempts > 0;
      // The writer needs the whole brief: what to research, the pitch intent, and what the host actually said.
      const request = JSON.stringify({ summary: brief.summary, intent: brief.intent ?? null, host_said: brief.messages.slice(-12),
        as_of: collection && new Date(collection.started_at).toISOString().slice(0, 10),
        collection: collection && { notes: collection.research_notes, stop_reason: collection.stop_reason },
        // Checked answers to the research checklist. The writer must carry each covered answer into the brief.
        ...(collection && "checklist" in collection && collection.checklist.length && { coverage: collection.checklist.map(item => ({
          question: item.question, status: item.status,
          ...(item.status === "covered" ? { answer: item.answer, evidence_id: item.evidence_id, excerpt: item.excerpt } : { reason: item.reason }),
        })) }),
        ...(previous_findings && { already_verified: previous_findings }),
        ...(repairing && { draft_feedback }) });
      const prompt = verified_candidate
        ? request + "\nThe existing research context is already verified and will be kept. Return only new source-backed paragraphs that address the cited omissions in the feedback. Do not restate the existing findings."
        : repairing
        ? request + "\nThe first draft did not pass verification. Use the feedback to repair the brief while preserving supported detail."
        : request;
      activity?.("draft_started", repairing ? "Requested a grounded revision of the research context." :
        "Requested a draft using the collected material.");
      try {
        draft = await provider.draft(prompt, studio ? writer_evidence(evidence, collection) : evidence, [...gaps], signal, studio ? "context" : undefined);
      } catch {
        check_current();
        signal.throwIfAborted();
        if (restore_candidate()) break;
        if (studio) throw new AppError(503, "Context drafting was interrupted. Retry research.");
        gaps.add("Narrative synthesis did not finish.");
      }
      check_current();
      draft_attempts++;
      if (draft) save_draft();
    }
    check_current();
    if (draft) {
      const by_id = new Map(evidence.map(item => [item.id, item]));
      if (collection) {
        const bind_records = <T extends { support: { evidence_id: string; excerpt: string }[] }>(unit: T): T => ({
          ...unit, support: unit.support.map(({ evidence_id }) => ({ evidence_id, excerpt: by_id.get(evidence_id)?.passage ?? "" })),
        });
        draft = { ...draft, sections: draft.sections.map(section => ({ ...section, paragraphs: section.paragraphs.map(bind_records) })) };
      }
      const findings = supported_findings(draft, evidence, gaps);
      const pitch_script = draft.pitch_script ?? [];
      const complete_script = !studio && pitch_script.length >= 3 && pitch_script.length <= 6 &&
        pitch_script[0].purpose === "opening" && pitch_script.at(-1)?.purpose === "close" &&
        pitch_script.slice(1, -1).every(passage => passage.purpose === "point") &&
        pitch_script.every(passage => passage.prose.trim() && passage.prose.length <= 1800 &&
          passage.support.length && passage.support.every(ref =>
            quotes(by_id.get(ref.evidence_id)?.passage, ref.excerpt)));
      draft = { ...findings, gaps: draft.gaps, graph_xml: studio ? draft.graph_xml : undefined,
        pitch_chart: !studio && selected_chart(draft.pitch_chart,evidence) ? draft.pitch_chart : null, pitch_script: complete_script ? pitch_script : undefined };
    }
    const verdict = draft && await verify_draft(draft, evidence, [...gaps], provider, signal,
      () => activity?.("verification_started","Requested an independent check of the draft against its evidence."),
      reason => activity?.("verification_skipped", reason), collection ? brief : undefined, previous_findings);
    check_current();
    if (studio && draft && verdict?.decisions) {
      draft = keep_supported(draft, verdict.decisions, brief.intent?.subject ?? draft.title);
      if (!draft.sections.length) activity?.("verification_skipped", "No verified findings remained in the draft.");
    }
    if (verified_candidate) {
      if (draft?.sections.length && verdict?.decisions) {
        draft = with_verified_additions(verified_candidate.draft, draft);
        grounding = verified_candidate.grounding;
        activity?.("verified", "Added verified findings to the completed brief.");
        save_draft();
      } else if (restore_candidate()) break;
      continue;
    }
    const usable = !!verdict?.decisions && !!draft?.sections.length;
    if (studio && !usable) {
      signal.throwIfAborted();
      if (draft_attempts >= draft_limit) {
        if (restore_candidate()) break;
        throw new AppError(422, "I read your material but couldn't verify the research context. Point me to one specific example or result you want to include.");
      }
      draft_feedback = verdict?.feedback ?? [];
      draft = undefined;
      save_draft();
      continue;
    }
    const selection = draft?.pitch_chart;
    const approved_chart = verdict?.chart && selection ? selection : null;
    const accepted = studio ? usable : verdict?.prose === true;
    if (!accepted) {
      draft = source_extracts(evidence, draft);
      gaps.add("Independent prose verification was incomplete or rejected a finding. The speaking content uses eligible source extracts.");
    }
    if (draft) draft.pitch_chart = approved_chart;
    const checked: TGrounding = { version:1, mode:accepted ? "verified" : "source_extracts",
      ...(selection ? {chart:approved_chart ? "verified" : "withheld"} : {}) };
    // A checklist-built brief already covers the questions the agent planned; open questions are listed gaps.
    // Appending long-form writer paragraphs here costs a call and brings back process text, so it is skipped.
    if (studio && usable && draft && !built_from_checklist && verdict?.coverage_feedback?.length && draft_attempts < draft_limit) {
      verified_candidate = { draft, grounding: checked };
      draft_feedback = [...verdict.coverage_feedback, ...verdict.feedback ?? []];
      draft = undefined;
      save_draft();
      continue;
    }
    grounding = checked;
    if (selection && !approved_chart) gaps.add("The proposed chart did not pass independent verification and was withheld.");
    save_draft();
    if (accepted) activity?.("verified","The independent check accepted the draft.");
    else activity?.("fallback","The draft could not be verified. Switched to eligible source extracts.");
  }
  check_current();
  if (!draft || !grounding) throw new Error("Missing grounded research draft");
  for (const gap of draft.gaps) if (gap.trim()) gaps.add(gap);
  const findings = supported_findings(draft, evidence, gaps);
  if (studio && (grounding.mode !== "verified" || !findings.sections.length)) {
    throw new AppError(422, needs_more_evidence);
  }
  const bundle: TResearchBundle = { research_id: crypto.randomUUID(), brief_id: brief.brief_id, confirmed_brief: brief,
    findings, grounding, evidence, gaps: [...gaps] };
  if (studio) {
    const checked_graphs = draft.graph_xml ? await verify_graph_document(draft.graph_xml, evidence, provider.verify, signal, provider.repair_graph,
      () => activity?.("verification_started", "Checking a new chart with comparable source values.")) : undefined;
    check_current();
    return { ...bundle, verified_graphs: checked_graphs?.graphs ?? [] };
  }
  const legacy = { ...bundle, pitch_chart: draft.pitch_chart ?? null, pitch_script: draft.pitch_script };
  return { ...legacy, markdown: research_report(legacy), pitch_markdown: pitch_markdown(legacy) };
};
