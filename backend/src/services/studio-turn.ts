import { createHash } from "node:crypto";
import { log_failure } from "../middleware/trace";
import { AppError } from "../errors/app-error";
import type { SessionStore } from "../repositories/session";
import { source_summary } from "../repositories/source";
import { agent_turn_schema, allowed_actions, spoken_text_limit, url_selection_limit } from "../types/studio-turn";
import type { TAgentAction, TAgentTurn, TPitchIntent, TResearchProposal, TStudioActivity, TStudioScopeInput, TStudioState, TStudioTurn, TStudioTurnInput } from "../types/studio-turn";
import type { TEvidence, TResearchBrief } from "../types/research";
import { interview_workspace } from "./interview";
import { public_url } from "./research";
import { source_evidence } from "./source";
import type { TStudioAgent, TStudioAgentInput } from "./studio-agent";
import { studio_context } from "./studio-state";
import { quotes } from "./excerpt";
import { site_url } from "./host-pages";
import type { TLiveExchange } from "./live-interviewer";
import type { TLiveModel } from "../types/live-turn";
import { classify_live_turn, live_context } from "./live-turn";
import { prepare_presentation_edit, presentation_claim_evidence, presentation_edit_claims } from "./presentation-edit";
import type { TGroundedPresentationEdit } from "./presentation-edit";
import { verify_presentation_claims } from "./presentation-grounding";
import { pitch_variant_key } from "../repositories/deck";
import { approve_studio_mission, revise_mission_from_turn, studio_outcome, sync_mission_proposal, adopt_host_deck_request } from "./director";
import type { TOutcomeContract } from "../types/mission";

export { initial_studio_context, studio_context } from "./studio-state";

export type TStudioTurnServices = { agent: TStudioAgent; ensure_research: () => void; wake: (job_id: string) => void;
  wake_deck?: () => void; deck_editor?: TLiveModel; verify_deck_edit?: typeof verify_presentation_claims };
type TStudioExecution = Omit<TStudioTurnServices, "agent">;
type TStudioDeckAction = Extract<TAgentAction, { kind: "prepare_slides" | "revise_slide" }>;
type TStudioMissionAction = Extract<TAgentAction, { kind: "mission_command" }>;
type TEvaluatedRevision = { message: string; change?: TGroundedPresentationEdit & { deck_id: string; research_id: string } };
export type TMissionTurnBasis = { mission_id: string; revision: number };
export type TStudioVoiceTurnBasis = { revision: number; proposal_id: string | null; proposal_heard: boolean; mission?: TMissionTurnBasis };


// Models sometimes name a language ("english", "Telugu") instead of giving a tag. Store only 2–3 letter tags.
const known_languages = ["en", "hi", "te", "ta", "kn", "ml", "mr", "bn", "gu", "pa", "ur", "es", "fr", "de", "pt", "it", "nl", "ja", "ko", "zh", "ar", "ru", "tr", "id"];
const language_names = new Map(known_languages.map(code => [new Intl.DisplayNames(["en"], { type: "language" }).of(code)!.toLowerCase(), code]));
export const language_tag = (value: string | null | undefined) => {
  const text = value?.trim();
  if (!text) return;
  const named = language_names.get(text.toLowerCase());
  if (named) return named;
  try {
    const [tag] = Intl.getCanonicalLocales(text);
    return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/iu.test(tag) ? tag : undefined;
  } catch { return; }
};

export const studio_wording = (language: string) => {
  const base = language.split("-")[0];
  if (base === "hi") return { retry: "माफ़ कीजिए, वह बात छूट गई। क्या आप फिर से कहेंगे?", edit: "आप क्या बदलना चाहते हैं?",
    start: "मैं अब शोध शुरू कर रहा हूँ।", approve: "क्या मैं शोध शुरू करूँ?", file_gap: "चुनी हुई फ़ाइलों में इसका जवाब नहीं मिला।" };
  if (base === "te") return { retry: "క్షమించండి, అది వినబడలేదు. మళ్లీ చెప్పగలరా?", edit: "మీరు ఏమి మార్చాలనుకుంటున్నారు?",
    start: "ఇప్పుడు పరిశోధన ప్రారంభిస్తున్నాను.", approve: "పరిశోధన ప్రారంభించనా?", file_gap: "ఎంచుకున్న ఫైళ్లలో దీనికి సమాధానం దొరకలేదు." };
  return { retry: "I couldn’t reach the AI model just now, so nothing changed. Please send that again.", edit: "What would you like to change?",
    start: "I’ll start the research now.", approve: "Shall I start?", file_gap: "I couldn't find support for that in the selected files." };
};



const clear_proposal = (state: TStudioState) => {
  state.proposal = null;
  state.proposal_heard = false;
  state.proposal_turn_id = undefined;
  state.phase = "interview";
};

const selected_sources = (db: SessionStore, session: string, input: TStudioTurnInput, state: TStudioState) =>
  db.sources.selected(session, [...new Set(input.source_ids ?? state.source_ids)]);

const scope_urls = (values: string[]) => values.map(value => {
  const url = public_url(value);
  if (!url) throw new AppError(400, "Use public HTTP or HTTPS source addresses");
  return url;
});

const scope_from_turn = (input: TStudioTurnInput, state: TStudioState, files: ReturnType<typeof selected_sources>) => ({
  urls: (input.urls ? scope_urls(input.urls) : state.urls ?? []).slice(-url_selection_limit),
  source_policy: input.source_policy ?? state.source_policy ?? "public_search",
  materials: input.materials ?? state.materials,
  source_ids: files.map(file => file.source_id),
});

const changed_scope = (state: TStudioState, scope: ReturnType<typeof scope_from_turn>) =>
  scope.source_policy !== state.source_policy || scope.materials !== state.materials ||
  JSON.stringify(scope.source_ids) !== JSON.stringify(state.source_ids) || JSON.stringify(scope.urls) !== JSON.stringify(state.urls ?? []);

export const update_studio_scope = (db: SessionStore, session: string, input: TStudioScopeInput) => {
  const { state, snapshot, revision } = studio_context(db, session);
  const expected = state.phase === "proposed" ? state.proposal?.proposal_id ?? null : null;
  if (input.expected_proposal_id !== expected) throw new AppError(409, "The current plan changed. Reopen the studio before editing it.");
  const sources = db.sources.selected(session, [...new Set(input.source_ids)]);
  const scope = { urls: [...new Set(scope_urls(input.urls))], source_ids: sources.map(source => source.source_id),
    materials: input.materials, source_policy: input.source_policy };
  if (!changed_scope(state, scope)) return;
  if (state.phase === "researching") throw new AppError(409, "The approved research is still running");
  if (state.phase === "proposed") clear_proposal(state);
  Object.assign(state, scope);
  db.studio.update_scope(session, revision, state, snapshot && revision > 0 ? snapshot.prior_history : interview_workspace(session, db).history);
};

const words = new Intl.Segmenter(undefined, { granularity: "word" });
const file_context = (evidence: TEvidence[], message: string) => {
  const terms = new Set([...words.segment(message.toLowerCase())].filter(part => part.isWordLike && part.segment.length >= 3).map(part => part.segment));
  return evidence.map(row => ({ row, matches: [...terms].filter(word => row.passage.toLowerCase().includes(word)).length }))
    .sort((a, b) => b.matches - a.matches).slice(0, 16)
    .map(({ row }) => ({ id: row.id, origin: row.origin, location: row.location, passage: row.passage.slice(0, 1200) }));
};

const request_hash = (input: TStudioTurnInput) => createHash("sha256").update(JSON.stringify(input)).digest("hex");

const plan_readback = (proposal: TResearchProposal, reply: string) => {
  const parts = [];
  if (!reply.toLowerCase().includes(proposal.summary.toLowerCase())) parts.push(proposal.summary);
  const missing_urls = proposal.urls.filter(url => !reply.includes(new URL(url).hostname));
  if (missing_urls.length) parts.push(missing_urls.join(", "));
  parts.push(reply);
  return parts.join("\n\n");
};

const readback_numbers = [
  ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"],
  ["शून्य", "एक", "दो", "तीन", "चार", "पाँच", "छह", "सात", "आठ", "नौ", "दस", "ग्यारह", "बारह"],
  ["సున్నా", "ఒకటి", "రెండు", "మూడు", "నాలుగు", "ఐదు", "ఆరు", "ఏడు", "ఎనిమిది", "తొమ్మిది", "పది", "పదకొండు", "పన్నెండు"],
];
const spoken_quantity = (count: number, units: string[]) => [String(count), ...readback_numbers.map(names => names[count])]
  .filter(Boolean).flatMap(number => units.map(unit => `${number} ${unit}`));

const mission_readback = (contract: TOutcomeContract): NonNullable<TStudioTurn["mission_readback"]> => {
  const { slide_count } = contract.deliverable;
  const deck_size = slide_count === "auto" ? "a slide deck sized for the available material" : `${slide_count} ${slide_count === 1 ? "slide" : "slides"}`;
  const scope = contract.sources.public_search ? "the public web and your approved materials" : "only your approved materials";
  const facts = contract.must_include.map(fact => fact.text);
  const dollars = contract.budget.usd;
  const minutes = contract.budget.minutes;
  return {
    text: `Create ${deck_size} for ${contract.audience} about ${contract.subject}. Use ${scope}. ` +
      `The budget is ${dollars} US dollars and ${minutes} minutes.${facts.length ? ` Include these host statements verbatim. ${facts.join("\n")}` : ""}`,
    required: [
      ...(slide_count === "auto" ? [] : [spoken_quantity(slide_count, ["slide", "slides", "स्लाइड", "स्लाइडें", "స్లైడ్", "స్లైడ్లు", "స్లైడ్‌లు"])]),
      contract.sources.public_search ? ["public web", "public sources", "public search", "सार्वजनिक वेब", "सार्वजनिक स्रोत", "పబ్లిక్ వెబ్", "పబ్లిక్ సోర్సులు"]
        : ["only your approved materials", "only your files", "only the supplied material", "only your material", "केवल आपकी फ़ाइलें", "सिर्फ़ आपकी फ़ाइलें", "మీ ఫైళ్లు మాత్రమే"],
      [`$${dollars}`, ...spoken_quantity(dollars, ["US dollar", "US dollars", "dollar", "dollars", "USD", "अमेरिकी डॉलर", "डॉलर", "యూఎస్ డాలర్లు", "డాలర్లు"])],
      spoken_quantity(minutes, ["minute", "minutes", "मिनट", "నిమిషాలు"]),
      ...facts.map(fact => [fact]),
    ],
  };
};

const new_brief = (proposal: TResearchProposal, state: TStudioState, history: ReturnType<typeof interview_workspace>["history"],
  input: TStudioTurnInput, text: string, files: ReturnType<typeof selected_sources>): TResearchBrief => ({
  brief_id: crypto.randomUUID(), summary: proposal.summary, question: null, public_queries: proposal.queries, ...(proposal.intent && { intent: proposal.intent }),
  urls: proposal.urls, source_policy: proposal.source_policy, sources: files.map(source_summary), materials: state.materials,
  studio_version: 2, studio_notes: state.factual_notes ?? [],
  messages: [...history.filter(turn => turn.role === "host").slice(-11).map(turn => turn.text), input.message],
  history: [...history, { role: "host", text: input.message }, { role: "assistant", text }],
});

const deck_action_from = (turn: TAgentTurn | null) => turn?.actions.find((action): action is TStudioDeckAction =>
  action.kind === "prepare_slides" || action.kind === "revise_slide");

const evaluate_revision = async (db: SessionStore, session: string, turn: TStudioTurnInput,
  action: Extract<TStudioDeckAction, { kind: "revise_slide" }>, services: TStudioExecution): Promise<TEvaluatedRevision> => {
  const { phase } = studio_context(db, session).state;
  const brief = db.current_brief(session);
  const research = brief && db.research_by_brief(session, brief.brief_id);
  if (phase !== "done" || !research) return { message: "Finish research before editing slides." };
  const mission = db.missions.current(session);
  const mission_deck = mission?.research_id === research.research_id && mission.deck_id && mission.deck_revision
    ? db.decks.get(session, mission.deck_id, mission.deck_revision) : undefined;
  const saved = mission_deck ?? db.decks.variants(session, research.research_id)[0];
  const deck = mission_deck ?? (saved && db.decks.get(session, saved.deck_id));
  if (!deck) return { message: "Prepare a deck before editing a slide." };
  const slide = deck.slides[(action.slide_number ?? (deck.slides.length === 1 ? 1 : 0)) - 1];
  if (!slide) return { message: `Which slide should I change? This deck has ${deck.slides.length} slides.` };
  const approved = db.research_for_deck(session, deck) ?? research;
  const request = { turn_id: turn.turn_id, base_revision: deck.revision, slide_id: slide.slide_id, message: turn.message };
  const context = live_context(deck, slide, request, approved, []);
  try {
    const signal = AbortSignal.timeout(35_000);
    const decision = await (services.deck_editor ?? classify_live_turn)(context, signal);
    if (decision.kind !== "edit") return { message: decision.text || "Which part of the slide should I change?" };
    const change = prepare_presentation_edit(request, decision, context, approved);
    if (change.kind !== "edit") return { message: change.text };
    const claims = presentation_edit_claims(change, context);
    const evidence = presentation_claim_evidence(claims, approved, turn.message);
    if (claims.length && !await (services.verify_deck_edit ?? verify_presentation_claims)(claims, evidence, signal)) {
      return { message: "The available sources don’t verify that wording. Can you give an exact statement or source?" };
    }
    signal.throwIfAborted();
    return { message: "Review the proposed slide change.", change: { ...change, deck_id: deck.deck_id, research_id: research.research_id } };
  } catch (error) {
    log_failure("studio.revise_slide", error, { session });
    return { message: "I couldn’t draft that slide change. Try again in the preview." };
  }
};

const apply_turn = (db: SessionStore, session: string, input: TStudioTurnInput, agent_turn: TAgentTurn | null, services: TStudioExecution,
  basis?: TStudioVoiceTurnBasis, allow_spoken_approval = true, voice_items?: string[], record = true,
  accepted_revision?: TEvaluatedRevision): TStudioTurn => {
  const fingerprint = request_hash(input);
  const saved = db.studio.replay(session, input.turn_id, fingerprint);
  if (saved) return saved;
  const current = studio_context(db, session);
  const { state, revision, snapshot, brief } = current;
  // A voice turn may have started before the previous reply was saved. Its words are still the host's and are kept;
  // only spoken consent depends on what was heard, and that is checked against the basis where research is started.
  if (input.brief_id && input.brief_id !== brief?.brief_id) throw new AppError(409, "Brief revision is stale");
  if (input.answer_to && (state.phase !== "proposed" || input.answer_to !== state.proposal?.proposal_id)) {
    throw new AppError(409, "This proposal is no longer open");
  }
  if (input.option_id && (input.input !== "typed" || !input.answer_to)) throw new AppError(400, "Choose the current proposal");
  const history = interview_workspace(session, db).history;
  const host_messages = [...history.filter(turn => turn.role === "host").map(turn => turn.text), input.message];
  const prior_proposal_id = state.proposal?.proposal_id;
  const prior_history = snapshot && revision > 0 ? snapshot.prior_history : history;
  // Label the turn with the language the reply is written in; the saved preference only guides the agent and the fallback line.
  const language = language_tag(agent_turn?.language) ?? language_tag(state.reply_language) ?? language_tag(state.last_language) ?? "en";
  const wording = studio_wording(language);
  let text = agent_turn?.reply ?? wording.retry;
  let activity: TStudioActivity | undefined;
  let approved_brief: TResearchBrief | undefined;
  let readback: TStudioTurn["mission_readback"];
  let apply_mission: (() => void) | undefined;
  let apply_deck: (() => void) | undefined;
  let deck_queued = false;
  const files = selected_sources(db, session, input, state);
  let displaced = false;

  if (agent_turn || input.option_id) {
    const scope = scope_from_turn(input, state, files);
    const scope_changed = changed_scope(state, scope);
    if (input.option_id === "approve" && scope_changed) throw new AppError(409, "Source selection changed. Review the new plan before approving.");
    if (state.phase !== "researching") {
      if (scope_changed && state.phase === "proposed") clear_proposal(state);
      Object.assign(state, scope);
    }
    state.last_language = language;
    const initial_phase = state.phase;
    const deck_action = deck_action_from(agent_turn);
    const mission_action = input.option_id ? undefined : agent_turn?.actions.find(action => action.kind === "mission_command");
    const actions = agent_turn?.actions.filter(action => allowed_actions[initial_phase].includes(action.kind) &&
      (!(deck_action || mission_action) || action.kind === "set_reply_language")) ?? [];
    const action = <K extends TAgentAction["kind"]>(kind: K) => actions.find(item => item.kind === kind) as Extract<TAgentAction, { kind: K }> | undefined;
    const remember = action("remember");
    if (remember) {
      const goal = remember.goal?.trim();
      if (goal && !files.some(file => file.filename.toLowerCase() === goal.toLowerCase()) && goal !== state.goal) {
        state.goal = goal;
        if (state.phase === "proposed") { clear_proposal(state); displaced = true; }
      }
      // A live proposal can cite a fact from an earlier saved host turn. Agent speech is never eligible.
      const host_words = !record && input.input === "speech"
        ? [input.message, ...history.filter(turn => turn.role === "host").slice(-12).map(turn => turn.text)] : [input.message];
      const notes = remember.notes.filter(note => note.trim() && host_words.some(words => words.includes(note)));
      state.notes = [...new Set([...state.notes, ...notes])].slice(-12);
      state.factual_notes = [...new Set([...(state.factual_notes ?? []), ...notes])].slice(-12);
    }
    const requested_language = action("set_reply_language")?.language;
    const requested_tag = language_tag(requested_language);
    if (requested_tag) state.reply_language = requested_tag;
    const proposal = action("propose_research");
    if (proposal && state.goal) {
      const approved_urls = proposal.urls.flatMap(value => site_url(value) ?? []);
      const urls = state.source_policy === "files_only" ? [] : [...new Set([...(state.urls ?? []), ...approved_urls])];
      state.proposal = {
        proposal_id: crypto.randomUUID(), summary: proposal.summary, urls, queries: state.source_policy === "files_only" ? [] : proposal.queries,
        source_policy: state.source_policy ?? "public_search", ...(proposal.intent && { intent: proposal.intent }),
      };
      state.proposal_turn_id = input.turn_id;
      state.proposal_heard = false;
      state.phase = "proposed";
      const approval_question = ["en", "hi", "te"].includes(language.split("-")[0]) ? studio_wording(language).approve : text;
      text = plan_readback(state.proposal, approval_question);
      const outcome = studio_outcome(state, host_messages);
      if (!record && outcome) readback = mission_readback(outcome);
    }
    if (input.option_id === "edit") {
      clear_proposal(state);
      text = wording.edit;
    }

    const wants_start = input.option_id === "approve" || !(deck_action || mission_action) && !!agent_turn?.actions.some(action => action.kind === "start_research");
    if (wants_start) {
      const proposed = state.phase === "proposed" && state.proposal && state.proposal_turn_id !== input.turn_id;
      const heard = basis ? basis.proposal_id === state.proposal?.proposal_id && basis.proposal_heard && state.proposal_heard : state.proposal_heard;
      const consent = input.option_id === "approve" || allow_spoken_approval && input.input === "speech" && !!action("start_research") &&
        !proposal && !displaced && heard;
      if (proposed && consent && state.proposal) {
        services.ensure_research();
        text = wording.start;
        approved_brief = new_brief(state.proposal, state, history, input, text, files);
        state.phase = "researching";
        activity = { tool: "queue_research", status: "queued", result: text };
      } else if (state.phase === "proposed" && state.proposal) {
        text = plan_readback(state.proposal, wording.approve);
        const pending_mission = db.missions.current(session);
        if (!record && pending_mission?.proposal_id === state.proposal.proposal_id) readback = mission_readback(pending_mission.contract);
        state.proposal_turn_id = input.turn_id;
        state.proposal_heard = false;
      } else if (state.phase !== "researching") {
        text = wording.edit;
      }
    } else if (mission_action) {
      const version = basis?.mission;
      if (!version || !input.message.trim() || input.message === "…") throw new AppError(409, "Open the current Mission to request a change.");
      apply_mission = () => { revise_mission_from_turn(db, session, version.revision, input.message, mission_action.patch, version.mission_id); };
      if (state.phase === "proposed") clear_proposal(state);
      text = "Review and approve the revised presentation plan in Mission.";
    } else if (deck_action) {
      const research = brief && db.research_by_brief(session, brief.brief_id);
      if (initial_phase !== "done" || !research) text = "Finish research before preparing or editing slides.";
      else if (deck_action.kind === "prepare_slides") {
        const count = deck_action.slide_count;
        text = `Preparing ${count} ${count === 1 ? "slide" : "slides"}.`;
        activity = { tool: "prepare_slides", status: "queued", result: text };
        const receipt = activity;
        apply_deck = () => {
          const { deck, job } = db.deck_preparations.enqueue(session, research.research_id, pitch_variant_key({ slide_count: count }), count);
          adopt_host_deck_request(db, session, research.research_id, count, { deck, job });
          receipt.deck_preparation = { research_id: research.research_id, slide_count: count,
            ...(deck && { deck_id: deck.deck_id }), ...(job && { job_id: job.job_id }) };
          deck_queued = !!job;
          if (deck) {
            receipt.status = "completed";
            receipt.result = `${count} ${count === 1 ? "slide is" : "slides are"} ready.`;
          }
        };
      } else if (accepted_revision) {
        text = accepted_revision.message;
        if (accepted_revision.change?.research_id === research.research_id) {
          const { deck_id, request, attribution, sources } = accepted_revision.change;
          activity = { tool: "revise_slide", status: "awaiting_input", result: text };
          const receipt = activity;
          apply_deck = () => { receipt.deck_proposal = db.decks.propose(session, deck_id, request, { attribution, sources }); };
        }
      }
    } else if (state.proposal_turn_id !== input.turn_id && (agent_turn?.file_question || agent_turn?.citations?.length)) {
      const records = new Map(files.flatMap(source_evidence).map(item => [item.id, item]));
      const citations = (agent_turn.citations ?? []).flatMap(citation => {
        const record = records.get(citation.evidence_id);
        return record && quotes(record.passage, citation.excerpt)
          ? [{ ...citation, location: record.location }] : [];
      });
      text = citations.length ? citations.map(item => `“${item.excerpt}” (${item.location})`).join("\n") : wording.file_gap;
      if (records.size) activity = { tool: "read_source", status: "completed", result: citations.length ? "Read selected source records" : "No matching excerpt", citations };
    }
  }

  const turn: TStudioTurn = {
    turn_id: input.turn_id, created_at: Date.now(), user_text: input.message, text: text.slice(0, spoken_text_limit), ...(voice_items && { voice_items }),
    language, phase: state.phase, proposal: state.proposal,
    ...(input.answer_to && { answer_to: input.answer_to }), ...(input.option_id && { option_id: input.option_id }),
    ...(activity && { activity }),
    ...(readback && { mission_readback: readback }),
  };
  let job_id: string | undefined;
  const start_job = () => {
    if (db.current_brief(session)?.brief_id !== brief?.brief_id) throw new AppError(409, "Brief revision is stale");
    if (state.proposal && state.proposal.proposal_id !== prior_proposal_id) sync_mission_proposal(db, session, state, host_messages);
    if (approved_brief) {
      if (!db.replace_brief(session, brief?.brief_id, approved_brief)) throw new AppError(409, "Brief revision is stale");
      job_id = db.research_jobs.enqueue(session, approved_brief.brief_id).job_id;
      if (state.proposal) approve_studio_mission(db, session, state.proposal.proposal_id, approved_brief.brief_id, job_id);
    }
    apply_mission?.();
    apply_deck?.();
    if (turn.activity?.tool === "prepare_slides") turn.text = turn.activity.result;
  };
  const committed = record ? db.studio.commit(session, revision, state, prior_history, fingerprint, turn, start_job)
    : (db.studio.commit_state(session, revision, state, prior_history, start_job), turn);
  if (job_id) services.wake(job_id);
  if (deck_queued) services.wake_deck?.();
  return committed;
};

export type TVoiceAction = { kind: "propose_research"; goal: string; summary: string; queries: string[]; urls: string[]; intent: TPitchIntent;
  factual_notes?: string[] } | { kind: "start_research" } | TStudioDeckAction | TStudioMissionAction;

// A live voice tool call changes state through the same rules as a typed turn, but adds no turn: the words that were
// actually said are recorded separately by record_voice_exchange.
export const apply_voice_action = (db: SessionStore, session: string, message: string, action: TVoiceAction, services: TStudioExecution,
  mission?: TMissionTurnBasis) => {
  const { state, revision } = studio_context(db, session);
  const basis = { revision, proposal_id: state.proposal?.proposal_id ?? null, proposal_heard: state.proposal_heard, mission };
  const actions: TAgentAction[] = action.kind === "propose_research"
    ? [{ kind: "remember", goal: action.goal, notes: action.factual_notes ?? [] },
      { kind: "propose_research", summary: action.summary, queries: action.queries, urls: action.urls, intent: action.intent }]
    : [action];
  const language = language_tag(state.reply_language) ?? language_tag(state.last_language) ?? "en";
  const input: TStudioTurnInput = { turn_id: crypto.randomUUID(), message: message.trim() || "…", input: "speech" };
  const agent_turn = { reply: "…", language, actions };
  return action.kind === "revise_slide" ? evaluate_revision(db, session, input, action, services).then(revision =>
    apply_turn(db, session, input, agent_turn, services, basis, true, undefined, false, revision)) :
    apply_turn(db, session, input, agent_turn, services, basis, true, undefined, false);
};

// What the host and the agent actually said in one exchange, saved verbatim.
export const record_voice_exchange = (db: SessionStore, session: string, exchange: TLiveExchange) => {
  const host = exchange.host.trim();
  const agent = exchange.agent.trim();
  if (!host && !agent) return;
  const { state, revision, snapshot } = studio_context(db, session);
  const prior_history = snapshot && revision > 0 ? snapshot.prior_history : interview_workspace(session, db).history;
  const language = language_tag(state.reply_language) ?? language_tag(state.last_language) ?? "en";
  const turn: TStudioTurn = { turn_id: exchange.turn_id, created_at: Date.now(), user_text: host, text: agent.slice(0, spoken_text_limit),
    voice_items: exchange.voice_items, voice_reply: exchange.voice_reply, language, phase: state.phase, proposal: state.proposal,
    ...(exchange.activity && { activity: exchange.activity }) };
  return db.studio.commit(session, revision, state, prior_history, createHash("sha256").update(JSON.stringify(exchange)).digest("hex"), turn, () => {});
};

export const apply_studio_agent_turn = (db: SessionStore, session: string, input: TStudioTurnInput, agent_turn: TAgentTurn,
  services: TStudioExecution, basis?: TStudioVoiceTurnBasis, voice_items?: string[]) =>
  apply_turn(db, session, input, agent_turn_schema.parse(agent_turn), services, basis, !!basis, voice_items);

export const run_studio_turn = async (db: SessionStore, session: string, input: TStudioTurnInput, services: TStudioTurnServices,
  allow_spoken_approval = true): Promise<TStudioTurn> => {
  const replay = db.studio.replay(session, input.turn_id, request_hash(input));
  if (replay) return replay;
  const current = studio_context(db, session);
  const { state, revision, job } = current;
  if (input.option_id) return apply_turn(db, session, input, null, services);
  if (input.answer_to && input.answer_to !== state.proposal?.proposal_id) throw new AppError(409, "This proposal is no longer open");
  const files = selected_sources(db, session, input, state);
  const candidate = db.missions.current(session);
  const mission = candidate && ["needs_approval", "working", "needs_input"].includes(candidate.status) ? candidate : undefined;
  const agent_input: TStudioAgentInput = {
    message: input.message, state: state.phase === "researching" ? state : { ...state, ...scope_from_turn(input, state, files) },
    files: files.map(file => ({ filename: file.filename })), job_status: job?.status ?? null,
    history: interview_workspace(session, db).history.slice(-12).map(turn => ({ ...turn, text: turn.text.slice(0, 600) })),
    ...(files.length && { evidence: file_context(files.flatMap(source_evidence), input.message) }),
    ...(mission && { mission: { status: mission.status, slide_count: mission.contract.deliverable.slide_count,
      audience: mission.contract.audience, purpose: mission.contract.purpose } }),
  };
  const basis = { revision, proposal_id: state.proposal?.proposal_id ?? null, proposal_heard: state.proposal_heard,
    mission: mission && { mission_id: mission.mission_id, revision: mission.contract.revision } };
  if (mission?.status === "working") db.missions.begin_turn(session, mission.mission_id, mission.contract.revision, input.turn_id);
  try {
    let agent_turn: TAgentTurn | null = null;
    try { agent_turn = agent_turn_schema.parse(await services.agent(agent_input, AbortSignal.timeout(20000))); }
    catch (error) { log_failure("studio.agent", error, { session, turn_id: input.turn_id }); /* A failed generation cannot change scope or approve research. */ }
    const deck_action = deck_action_from(agent_turn);
    const revision_action = deck_action?.kind === "revise_slide" ? await evaluate_revision(db, session, input, deck_action, services) : undefined;
    return apply_turn(db, session, input, agent_turn, services, basis, allow_spoken_approval, undefined, true, revision_action);
  } finally {
    if (mission?.status === "working") db.missions.end_turn(session, input.turn_id);
  }
};
