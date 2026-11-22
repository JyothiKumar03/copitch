import type { SessionStore } from "../repositories/session";
import { mission_step } from "../repositories/mission";
import { pitch_variant_key } from "../repositories/deck";
import { source_summary } from "../repositories/source";
import type { TMission, TMissionDecision, TMissionTurnPatch, TOutcomeContract } from "../types/mission";
import type { TStudioState } from "../types/studio-turn";
import type { TResearchBrief, TResearchBundle } from "../types/research";
import type { TDeck, TEditProposal } from "../types/deck";
import { DEFAULT_PRESENTATION_SLIDES, MAX_PRESENTATION_SLIDES, extractPresentationSlideCount } from "../../../shared/presentation";
import { DEFAULT_WEBSITE_WALKTHROUGH_DEPTH } from "../../../shared/website-walkthrough";
import { site_navigation } from "./site-policy";
import { configured_site_decider } from "./site-agent";
import { website_capture_url } from "./website-capture";
import { save_site_source } from "./site-source";
import { AppError } from "../errors/app-error";
import { configured_mission_budget_usd, mission_turn_patch } from "../types/mission";
import { numbers_stated_in, quotes } from "./excerpt";
import { mission_interruption } from "./mission-retry";
import { studio_context } from "./studio-state";
import { contains_draft_instruction, is_non_omission } from "./slide-content";

// The website step gets half the mission allowance so research and slides keep the rest.
const site_budget = (c: TOutcomeContract) => Math.round(c.budget.usd * 50) / 100;
const requested_count = (messages: string[]) => extractPresentationSlideCount(...messages) ?? DEFAULT_PRESENTATION_SLIDES;

// Preserve exact factual sentences when the model groups them with a source or slide direction.
const note_sentences = new Intl.Segmenter(undefined,{ granularity: "sentence" });
const quoted_factual_note = (text: string) => {
  const note = text.trim().replace(/^(?:please\s+)?(?:add|include|mention)\s+(?:that\s+)?(?=I\s|my name is\s)/iu,"");
  if (/^(?:please\s+)?(?:include|add|mention|cite)\s/iu.test(note) ||
      /^(?:please\s+)?use\s+(?:my|our|the|this|that|these|those|only|just|https?:\/\/)\b/iu.test(note)) return;
  return note;
};

const introduction_subject = (proposed: string, messages: string[]) => {
  // Only replace a model's deliverable wording when it explicitly introduces
  // this same person. A host can introduce themselves while requesting a product deck.
  const target = proposed.trim().match(/\b(?:introduction|intro(?:duction)? deck|profile|biography)\s+(?:about|of|to)\s+(.+?)(?=\s+(?:for|using|with|from|including)\b|[,;.]|$)/iu)?.[1]?.trim() ?? proposed.trim();
  const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replace(/\s+/gu," ").trim();
  const names = new Map<string,string>();
  for (const message of messages) {
    for (const match of message.matchAll(/(?:^|[.!?]\s+)\s*my name is\s+([^,.!?\n]{1,90})(?=[,.!?\n]|$)/giu)) {
      const name = match[1].trim();
      if (/^[\p{L}\p{M}'’-]+(?:\s+[\p{L}\p{M}'’-]+){0,5}$/u.test(name)) names.set(normalize(name),name);
    }
  }
  if (names.size !== 1) return proposed;
  const [name] = names.values();
  return normalize(target) === normalize(name) || /^(?:me|myself)$/iu.test(target) ? name : proposed;
};

export const studio_outcome = (state: TStudioState, host_messages: string[]): TOutcomeContract | null => {
  const proposal = state.proposal;
  if (!proposal || !/\b(?:deck|slides?|presentation|pitch)\b/iu.test([state.goal,proposal.intent?.deliverable,...host_messages].join(" "))) return null;
  const intent = proposal.intent;
  const count = requested_count([intent?.deliverable ?? "",...host_messages]);
  const tone = [...host_messages].reverse().map(message => message.match(/\b(fun|formal|conversational|playful|technical|professional)\b/iu)?.[1]).find(Boolean);
  const notes = (state.factual_notes ?? []).flatMap(note => {
    if (!host_messages.some(message => quotes(message,note))) return [];
    const sentences = Array.from(note_sentences.segment(note),part => part.segment.trim());
    const mixed = sentences.length > 1 && sentences.some(text => quoted_factual_note(text) !== text);
    return (mixed ? sentences : [note]).flatMap(text => {
      const fact = quoted_factual_note(text);
      return fact ? [fact] : [];
    });
  });
  const explicit = host_messages.flatMap(message =>
    [...message.matchAll(/\b(?:add|include|mention)\s+(?:that\s+)?(I (?:love|like|enjoy) [^,.!?\n]{2,160})/giu)].map(match => match[1].trim()));
  // Notes accumulate across turns, so the same sentence can arrive twice; keep one copy per normalized text.
  const fact_key = (text: string) => text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
  const facts = [...new Map([...notes,...explicit.filter(fact => !notes.some(note => quotes(note,fact)))]
    .map(text => [fact_key(text),text.trim()])).values()].slice(-24);
  const requested_site = proposal.urls.find(url => {
    const host = new URL(url).hostname.replace(/^www\./iu,"");
    return host_messages.some(message => /\b(?:walk[- ]?through|tour (?:the|my|our) (?:site|website))\b/iu.test(message) &&
      message.toLowerCase().includes(host));
  });
  return { contract_id: proposal.proposal_id, revision: 1, subject: introduction_subject(intent?.subject ?? state.goal ?? proposal.summary,host_messages),
    audience: intent?.audience ?? "Presentation audience", purpose: intent?.outcome ?? proposal.summary,
    deliverable: { kind: "deck", slide_count: count >= 1 && count <= MAX_PRESENTATION_SLIDES ? count : "auto", ...(tone && { tone }) },
    must_include: facts.map(text => ({ text, source: "host" })),
    sources: { urls: proposal.urls, files: state.source_ids, public_search: proposal.source_policy === "public_search",
      site_tasks: requested_site ? [{ url: requested_site, goal: intent?.outcome ?? proposal.summary, mode: "read" }] : [],
      ...(state.materials && { materials: state.materials }) },
    success_checks: ["Deliver the requested slide count.", "Show each required host fact with its citation.", "Pass factual and render review."],
    budget: { usd: configured_mission_budget_usd(), minutes: 10 } };
};

export const sync_mission_proposal = (db: SessionStore, session: string, state: TStudioState, host_messages: string[]) => {
  const contract = studio_outcome(state,host_messages);
  if (!contract || !state.proposal) return;
  const proposal_id = state.proposal.proposal_id;
  return db.missions.atomic(() => {
    const old = db.missions.current(session);
    if (old?.site_run_id && old.proposal_id !== proposal_id) db.site_runs.stop(session,old.site_run_id);
    const saved = db.missions.proposal(session,contract,proposal_id);
    if (contract.deliverable.slide_count === "auto" && saved.status === "needs_approval") {
      const requested = requested_count([state.proposal?.intent?.deliverable ?? "",...host_messages]);
      wait_for_host(saved,[`You requested ${requested} slides. Which supported count between 1 and ${MAX_PRESENTATION_SLIDES} should the deck use?`]);
      db.missions.save(session,saved);
    }
    return saved;
  });
};

const validate_scope = (mission: TMission) => {
  const contract = mission.contract;
  if (contract.budget.usd <= 0 || contract.budget.usd > configured_mission_budget_usd()) throw new AppError(422,"The plan exceeds the configured mission spending limit. Review the budget.");
  if (contract.deliverable.slide_count !== "auto" && (contract.deliverable.slide_count < 1 || contract.deliverable.slide_count > MAX_PRESENTATION_SLIDES))
    throw new AppError(422,`Choose a deck size between 1 and ${MAX_PRESENTATION_SLIDES} slides and approve the revised plan.`);
  if (!contract.sources.public_search && contract.sources.urls.length)
    throw new AppError(422,"Enable public sources or remove the website addresses.");
  if (contract.sources.site_tasks.length > 1) throw new AppError(422,"Choose one public website walkthrough for this mission.");
  const task = contract.sources.site_tasks[0];
  if (task) {
    if (task.mode !== "read") throw new AppError(422,"Open Website to review the interactive walkthrough and its separate budget. Attach its saved source to this plan.");
    if (contract.sources.files.length >= 6) throw new AppError(422,"Remove one file to leave room for the walkthrough source.");
    const root = website_capture_url(task.url);
    if (!root || !("url" in site_navigation(root,root.href))) throw new AppError(422,"Choose a public starting page without sign-in, query parameters or a custom port.");
  }
};

const attach_research = (db: SessionStore, session: string, mission: TMission, brief_id: string, child_id: string) => {
  validate_scope(mission);
  if (mission.status !== "needs_approval") throw new AppError(409,"This plan is no longer awaiting approval.");
  mission.status = "working";
  // Each approved revision gets its own time allowance; spend stays cumulative against the budget.
  mission.started_at = Date.now();
  mission.approved_revision = mission.contract.revision;
  mission.brief_id = brief_id;
  mission.research_job_id = child_id;
  mission.research_id = null;
  mission.deck_job_id = null;
  mission.deck_id = null;
  mission.deck_revision = null;
  mission.host_edited_revision = null;
  db.missions.bind(session,mission,child_id);
  mission_step(mission,"research","Researching the sources approved for this revision.");
};

export const approve_studio_mission = (db: SessionStore, session: string, proposal_id: string, brief_id: string, research_job_id: string) => {
  const active = db.missions.current(session);
  if (!active) return;
  if (active.proposal_id !== proposal_id) {
    if (active.status === "needs_approval") throw new AppError(409,"Approve the revised outcome in Mission.");
    return;
  }
  return db.missions.change(session,active.mission_id,active.contract.revision,mission => {
    if (mission.contract.sources.site_tasks.length) throw new AppError(409,"Approve this website task in Mission so its capture finishes before research.");
    const brief = db.current_brief(session);
    if (!brief || brief.brief_id !== brief_id || brief.source_policy !== (mission.contract.sources.public_search ? "public_search" : "files_only") ||
        JSON.stringify(brief.urls) !== JSON.stringify(mission.contract.sources.urls) ||
        JSON.stringify(brief.sources?.map(source => source.source_id) ?? []) !== JSON.stringify(mission.contract.sources.files) ||
        brief.materials !== (mission.contract.sources.materials ?? "")) throw new AppError(409,"The approved source scope changed.");
    const c = mission.contract;
    db.replace_brief(session,brief_id,{ ...brief, studio_notes: c.must_include.map(fact => fact.text),
      intent: { subject: c.subject, audience: c.audience, outcome: c.purpose, deliverable: [c.deliverable.slide_count,"slides",c.deliverable.tone].filter(Boolean).join(" ") } });
    attach_research(db,session,mission,brief_id,research_job_id);
  });
};

const research_brief = (db: SessionStore, session: string, c: TOutcomeContract, source_id?: string): TResearchBrief => {
  const facts = c.must_include.map(item => item.text);
  return {
      brief_id: crypto.randomUUID(), studio_version: 2, studio_notes: facts, question: null,
      summary: [c.subject,c.audience,c.purpose,c.deliverable.tone,...facts].filter(Boolean).join(". "),
      intent: { subject: c.subject, audience: c.audience, outcome: c.purpose,
        deliverable: [c.deliverable.slide_count,"slides",c.deliverable.tone].filter(Boolean).join(" ") },
      sources: db.sources.selected(session,[...c.sources.files,...(source_id ? [source_id] : [])]).map(source_summary), urls: c.sources.urls,
      public_queries: c.sources.public_search ? [c.purpose] : [], source_policy: c.sources.public_search ? "public_search" : "files_only",
      materials: c.sources.materials ?? "", messages: [c.purpose], history: [],
    };
};

export const approve_mission = (db: SessionStore, session: string, id: string, revision: number) =>
  db.missions.change(session,id,revision,mission => {
    if (mission.approved_revision === revision && mission.status === "working") return;
    if (mission.status !== "needs_approval") throw new AppError(409,"Review the current plan before approval.");
    validate_scope(mission);
    const { state, snapshot, revision: studio_revision, brief: previous } = studio_context(db,session);
    if (mission.proposal_id && (state.phase !== "proposed" || state.proposal?.proposal_id !== mission.proposal_id))
      throw new AppError(409,"The conversation changed. Review the current plan.");
    const c = mission.contract;
    const brief = research_brief(db,session,c);
    const task = c.sources.site_tasks[0];
    if (task) {
      const site = db.site_runs.enqueue(session,{ request_id: crypto.randomUUID(), url: task.url, audience: c.audience, goal: task.goal,
        max_depth: DEFAULT_WEBSITE_WALKTHROUGH_DEPTH, approved: true },site_budget(c),configured_site_decider() ? "model" : "browser");
      mission.site_run_id = site.run_id;
      mission.approved_revision = revision;
      // Each approved revision gets its own time allowance; spend stays cumulative against the budget.
      mission.started_at = Date.now();
      mission.status = "working";
      mission.brief_id = previous?.brief_id ?? null;
      mission.research_job_id = null;
      mission.research_id = null;
      mission.deck_job_id = null;
      mission.deck_id = null;
      mission.deck_revision = null;
      mission_step(mission,"browse_site",`Reading public pages at ${new URL(task.url).hostname} for the approved goal. Site agent budget $${site_budget(c).toFixed(2)}.`);
      db.studio.commit_state(session,studio_revision,{ ...state, proposal: null, proposal_heard: false, phase: "interview", source_ids: c.sources.files, source_policy: brief.source_policy,
        urls: c.sources.urls, materials: c.sources.materials ?? "" },
        snapshot?.prior_history ?? [],() => {});
      return;
    }
    mission.site_run_id = null;
    db.studio.commit_state(session,studio_revision,{ ...state, phase: "researching", proposal: null, source_ids: c.sources.files,
      source_policy: brief.source_policy, urls: brief.urls, materials: brief.materials },snapshot?.prior_history ?? [],() => {
      if (!db.replace_brief(session,previous?.brief_id,brief)) throw new AppError(409,"The brief changed during approval.");
      const job = db.research_jobs.enqueue(session,brief.brief_id);
      attach_research(db,session,mission,brief.brief_id,job.job_id);
    });
  });

export const halt_mission = (db: SessionStore, session: string, id: string, revision: number, action: "stop" | "take-over") =>
  db.missions.change(session,id,revision,m => {
    const status = action === "stop" ? "stopped" : "paused";
    if (m.status === status) return;
    if (m.site_run_id) db.site_runs.stop(session,m.site_run_id);
    // An unapproved edit still points at the last approved child until the host accepts the new scope.
    if (m.approved_revision !== null && m.research_job_id && m.brief_id &&
        db.missions.owns_child(session,id,m.approved_revision,m.research_job_id)) db.research_jobs.stop(session,m.brief_id,m.research_job_id);
    m.status = status;
    mission_step(m,action === "stop" ? "stop" : "take_over",action === "stop" ? "Mission stopped. Saved work remains available." : "Paused for manual editing.");
  });

export const revise_mission_from_turn = (db: SessionStore, session: string, expected_revision: number, user_text: string, patch: TMissionTurnPatch, expected_mission_id: string) => {
  const current = db.missions.current(session);
  if (!current || current.mission_id !== expected_mission_id || !["needs_approval","working","needs_input"].includes(current.status)) throw new AppError(409,"There is no active mission to revise.");
  const change = mission_turn_patch.safeParse(patch);
  if (!change.success) throw new AppError(400,"Specify the requested change.");
  const { slide_count, audience, purpose, tone, add_host_fact, files_only } = change.data;
  if (add_host_fact && !quotes(user_text,add_host_fact)) throw new AppError(400,"Quote the host’s own words for the new required fact.");
  const c = current.contract;
  const revised: TOutcomeContract = { ...c, audience: audience ?? c.audience, purpose: purpose ?? c.purpose,
    deliverable: { ...c.deliverable, ...(slide_count && { slide_count }), ...(tone && { tone }) },
    sources: files_only ? { ...c.sources, public_search: false, urls: [], site_tasks: [] } : c.sources,
    must_include: add_host_fact && !c.must_include.some(fact => fact.text === add_host_fact) ?
      [...c.must_include,{ source: "host", text: add_host_fact }] : c.must_include };
  return db.missions.atomic(() => {
    const result = db.missions.revise(session,current.mission_id,expected_revision,revised);
    if (current.site_run_id) db.site_runs.stop(session,current.site_run_id);
    return result;
  });
};

export const adopt_approved_mission_edit = (db: SessionStore, session: string, proposal: TEditProposal) => {
  if (proposal.status !== "approved" || proposal.approved_revision !== proposal.base_revision + 1) return;
  const m = db.missions.current(session);
  const previously_edited = m?.status === "needs_input" && !!m.host_edited_revision && m.host_edited_revision === m.deck_revision;
  if (!m || !(m.status === "delivered" || previously_edited) || m.deck_id !== proposal.deck_id || m.deck_revision !== proposal.base_revision) return;
  const next = db.decks.get(session,proposal.deck_id,proposal.approved_revision);
  if (!next || next.research_id !== m.research_id) return;
  m.deck_revision = next.revision;
  m.host_edited_revision = next.revision;
  mission_step(m,"check_outcome",`Saved the host-approved change to deck revision ${next.revision}.`);
  const bundle = db.research_for_deck(session,next);
  const gaps = bundle ? outcome_gaps(m,next,bundle) : ["The revised deck’s cited research is unavailable."];
  if (gaps.length) wait_for_host(m,[`Open revision ${next.revision} to review the approved change.`,...gaps]);
  return db.missions.save(session,m);
};

const normal = (text: string) => text.toLocaleLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu," ").trim();
const exact_count = (mission: TMission) => mission.contract.deliverable.slide_count === "auto" ? DEFAULT_PRESENTATION_SLIDES : mission.contract.deliverable.slide_count;

export const outcome_gaps = (mission: TMission, deck: TDeck, bundle: TResearchBundle) => {
  const gaps: string[] = [];
  if (deck.research_id !== mission.research_id || bundle.brief_id !== mission.brief_id) gaps.push("The deck belongs to an earlier research revision.");
  if (deck.slides.length !== exact_count(mission)) gaps.push(`Expected ${exact_count(mission)} slides and found ${deck.slides.length}.`);
  if (deck.render_review?.status !== "passed") gaps.push("The deck has not passed render review.");
  const duration = mission.contract.deliverable.max_minutes;
  if (duration && (deck.pitch?.estimated_seconds ?? deck.slides.reduce((total,slide) => total + (slide.estimated_seconds ?? Infinity),0)) > duration * 60)
    gaps.push(`Confirm a speaking time of at most ${duration} minutes.`);
  if (normal(deck.title) !== normal(mission.contract.subject)) gaps.push(`Use the approved subject “${mission.contract.subject}” in the deck header.`);
  const evidence = new Map(bundle.evidence.map(row => [row.id,row]));
  const titles = new Set<string>();
  for (const slide of deck.slides) {
    if (titles.has(normal(slide.title))) gaps.push(`A slide title repeats: ${slide.title}`);
    titles.add(normal(slide.title));
    const rows = slide.evidence_ids.map(id => evidence.get(id));
    if (!rows.length || rows.some(row => !row)) gaps.push(`Restore the source passages for “${slide.title}”.`);
    const visible = [slide.title,...slide.highlights,slide.narration];
    if (contains_draft_instruction([visible,slide.template])) gaps.push(`Remove draft instructions from “${slide.title}”.`);
    const cited = rows.map(row => row?.passage ?? "").join("\n");
    const displayed = [...visible,JSON.stringify(slide.template ?? {}),slide.chart_period ?? "",JSON.stringify(slide.chart?.rows.map(row => [row.label,row.numerator,row.denominator]) ?? [])];
    if (!numbers_stated_in(displayed.join(" "),cited) || slide.sentences?.some(sentence => !numbers_stated_in(sentence.text,
      sentence.evidence_ids.map(id => evidence.get(id)?.passage ?? "").join("\n")))) gaps.push(`Verify the figures on “${slide.title}”.`);
  }
  for (const fact of mission.contract.must_include) {
    const item = normal(fact.text).replace(/^(?:i (?:love|like|enjoy)|i am|my) /u,"");
    const components = item.split(/\s+and\s+/u).filter(Boolean);
    if (!components.length || !components.every(part => deck.slides.some(slide =>
      normal([slide.title,...slide.highlights].join(" ")).includes(part) && slide.evidence_ids.some(id => {
        const row = evidence.get(id);
        return row?.origin === "host" && normal(row.passage).includes(part);
      })))) gaps.push(`Include the host’s statement with its citation: ${fact.text}`);
  }
  return [...new Set(gaps)];
};

export const wait_for_host = (mission: TMission, gaps: string[]) => {
  mission.status = "needs_input";
  mission.gaps = gaps;
  mission_step(mission,"ask_host",gaps[0] ?? "Which part of the approved outcome should change?");
};

export const queue_mission_deck = (db: SessionStore, session: string, mission: TMission, reason: string) => {
  if (!mission.research_id) throw new AppError(409,"Research is unavailable.");
  const count = exact_count(mission);
  const queued = db.deck_preparations.enqueue(session,mission.research_id,pitch_variant_key({ slide_count: count }),count);
  mission_step(mission,"prepare_deck",`Preparing ${count} slides. ${reason}`);
  if (queued.deck) { mission.deck_id = queued.deck.deck_id; mission.deck_revision = queued.deck.revision; }
  if (queued.job) { mission.deck_job_id = queued.job.job_id; db.missions.bind(session,mission,queued.job.job_id); }
};

// A host who asks for the same slides again in conversation resumes a waiting mission on that new preparation,
// so its outcome check runs instead of leaving the earlier question on screen.
export const adopt_host_deck_request = (db: SessionStore, session: string, research_id: string, count: number,
  queued: { deck?: TDeck | null; job?: { job_id: string } | null }) => {
  const m = db.missions.current(session);
  if (!m || m.status !== "needs_input" || m.research_id !== research_id || exact_count(m) !== count || (!queued.job && !queued.deck)) return;
  m.status = "working";
  m.gaps = [];
  m.deck_job_id = queued.job?.job_id ?? null;
  m.deck_id = queued.deck?.deck_id ?? null;
  m.deck_revision = queued.deck?.revision ?? null;
  mission_step(m,"prepare_deck",`Preparing ${count} slides again at the host’s request.`);
  if (queued.job) db.missions.bind(session,m,queued.job.job_id);
  return db.missions.save(session,m);
};

export const apply_director_decision = (db: SessionStore, session: string, m: TMission, choice: TMissionDecision) => {
  if (choice.tool === "ask_host") return wait_for_host(m,choice.gaps);
  if (choice.tool === "prepare_deck") return queue_mission_deck(db,session,m,choice.reason);
  mission_step(m,"check_outcome","The reviewed deck meets the approved outcome. Open the saved revision to present.");
  m.status = "delivered";
};

export const advance_mission = (db: SessionStore, session: string, mission: TMission) => {
  if (mission.status !== "working" || db.missions.host_speaking(mission)) return;
  if (mission.approved_revision !== mission.contract.revision || !mission.started_at ||
      Date.now() >= mission.started_at + mission.contract.budget.minutes * 60_000 ||
      mission.steps.filter(step => ["research","browse_site","prepare_deck","check_outcome","ask_host"].includes(step.tool)).length >= 24)
    return wait_for_host(mission,["The mission reached its approved time or step limit. Open its saved work or start a new outcome."]);
  if (mission.site_run_id && !mission.research_job_id) {
    const site = db.site_runs.get(session,mission.site_run_id);
    if (site?.status === "running" || site?.status === "queued") return;
    if (!site || site.status !== "completed" || !site.steps.length)
      return wait_for_host(mission,[site?.summary ?? "Which public page can show the requested website flow?"]);
    const previous = db.current_brief(session);
    if ((previous?.brief_id ?? null) !== mission.brief_id) return wait_for_host(mission,["The studio research changed during capture. Review the sources before continuing."]);
    const source = save_site_source(db,session,site);
    const brief = research_brief(db,session,mission.contract,source.source_id);
    if (!db.replace_brief(session,previous?.brief_id,brief)) throw new AppError(409,"The approved scope changed during capture.");
    const child = db.research_jobs.enqueue(session,brief.brief_id);
    mission.brief_id = brief.brief_id;
    mission.research_job_id = child.job_id;
    db.missions.bind(session,mission,child.job_id);
    mission_step(mission,"research",`Researching the approved sources, including ${site.steps.length} captured website steps.`);
    return;
  }
  const job = mission.research_job_id && db.research_jobs.get(session,mission.research_job_id);
  if (!job || job.brief_id !== mission.brief_id || db.current_brief(session)?.brief_id !== mission.brief_id)
    return wait_for_host(mission,["The research scope changed. Review the current sources before continuing."]);
  if (job.status === "queued" || job.status === "running") return;
  if (job.status === "failed") return wait_for_host(mission,[mission_interruption("research")]);
  if (!job.result || job.status !== "completed") return wait_for_host(mission,[job.error ?? "Research needs more material. Which source should support the missing information?"]);
  mission.research_id = job.result.research_id;
  const cached = db.missions.take_decision(mission);
  if (cached) return apply_director_decision(db,session,mission,cached);
  if (!mission.deck_job_id && !mission.deck_id) {
    const bundle = db.research_by_id(session,mission.research_id);
    if (!bundle) return wait_for_host(mission,["Reopen the approved research before preparing the deck."]);
    const lease = db.missions.claim_tool(mission,"plan");
    if (!lease) return;
    db.missions.bind(session,mission,lease);
    return { kind: "plan" as const, lease, bundle };
  }
  const preparation = mission.deck_job_id ? db.deck_preparations.get(session,mission.deck_job_id) : null;
  if (preparation?.status === "queued" || preparation?.status === "running") return;
  if (preparation?.status === "failed") {
    const failure = preparation.failure;
    if (failure?.reason_code === "provider_unavailable" || failure?.reason_code === "interrupted") return wait_for_host(mission,[mission_interruption("preparation")]);
    const supported = failure?.supported_slide_count ?? 0;
    // When every requested slide is supported, the stop is layout or review, not missing material.
    const question = supported >= exact_count(mission) ? `All ${supported} slides are written, but slide review did not finish. Open the presentation to fix the flagged slides, or try a different slide count?` :
      supported ? `Would you like to review the ${supported} supported slides or add a source for the requested ${exact_count(mission)}?` :
      failure?.reason_code === "insufficient_evidence" ? `Which source can you add for the missing material in the ${exact_count(mission)}-slide deck?` :
      "Would you like to review the saved research before trying slide preparation again?";
    return wait_for_host(mission,[question,...(failure?.gaps ?? []).filter(gap => !is_non_omission(gap)),failure?.message ?? preparation.error ?? "Slide preparation stopped."]);
  }
  const deck = preparation?.deck ?? (mission.deck_id && db.decks.get(session,mission.deck_id,mission.deck_revision ?? undefined));
  if (!deck) return wait_for_host(mission,["The saved deck is unavailable. Review the research and retry preparation."]);
  mission.deck_id = deck.deck_id;
  mission.deck_revision = deck.revision;
  const bundle = db.research_for_deck(session,deck);
  const gaps = bundle ? outcome_gaps(mission,deck,bundle) : ["The cited research is unavailable."];
  if (gaps.length) {
    mission_step(mission,"check_outcome","The deck needs changes before delivery.");
    return wait_for_host(mission,gaps);
  }
  const lease = db.missions.claim_tool(mission,"review");
  if (!lease) return;
  db.missions.bind(session,mission,lease);
  mission_step(mission,"check_outcome",`Verified the count, citations and layout of ${deck.slides.length} slides. Reviewing audience and purpose.`);
  return { kind: "review" as const, lease, deck };
};
