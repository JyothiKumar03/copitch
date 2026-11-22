import { expect, test } from "bun:test";
import { SessionStore } from "../src/repositories/session";
import { interview_workspace } from "../src/services/interview";
import { apply_studio_agent_turn, apply_voice_action, record_voice_exchange, run_studio_turn, studio_context, update_studio_scope } from "../src/services/studio-turn";
import type { TStudioAgent, TStudioAgentInput } from "../src/services/studio-agent";
import type { TAgentTurn, TStudioTurnInput } from "../src/types/studio-turn";
import type { TEvidence, TResearchBrief } from "../src/types/research";
import { pitch_variant_key } from "../src/repositories/deck";

const pitch_intent = { subject: "Onboarding pilot", audience: "The bank", outcome: "Agree to evaluate the pilot",
  deliverable: "A short pilot pitch" };
const remembered = {
  reply: "I'll review the onboarding pilot for the bank. Shall I start?", language: "en",
  actions: [
    { kind: "remember", goal: "Onboarding pilot for a bank", notes: ["I led three regulated onboarding pilots."] },
    { kind: "propose_research", summary: "Review the onboarding pilot for the bank", queries: ["bank onboarding"],
      urls: ["https://example.com/"], intent: pitch_intent },
  ],
} satisfies TAgentTurn;
const accepts = { reply: "I'll begin.", language: "en", actions: [{ kind: "start_research" }] } satisfies TAgentTurn;

const studio = () => {
  const db = new SessionStore(":memory:");
  const session = crypto.randomUUID();
  const responses: TAgentTurn[] = [];
  const calls: TStudioAgentInput[] = [];
  const jobs: string[] = [];
  const agent: TStudioAgent = async input => {
    calls.push(input);
    const response = responses.shift();
    if (!response) throw new Error("Fixture unavailable");
    return response;
  };
  const service = { agent, ensure_research: () => {}, wake: (id: string) => { jobs.push(id); } };
  const send = (message: string, overrides: Partial<TStudioTurnInput> = {}) =>
    run_studio_turn(db, session, { turn_id: crypto.randomUUID(), input: "typed", message, ...overrides }, service);
  const state = () => studio_context(db, session).state;
  const propose = async () => {
    responses.push(remembered);
    return send("Build an onboarding pilot pitch for the bank. I led three regulated onboarding pilots. Use https://example.com/.");
  };
  return { db, session, responses, calls, jobs, service, send, state, propose };
};

const completed_research = (db: SessionStore, session: string, evidence: TEvidence[] = []) => {
  const brief: TResearchBrief = { brief_id: crypto.randomUUID(), summary: "Onboarding pilot", question: null,
    source_policy: "files_only", messages: [], materials: "", urls: [], public_queries: [] };
  const research_id = crypto.randomUUID();
  db.replace_brief(session, undefined, brief);
  db.save_research(session, { research_id, brief_id: brief.brief_id, confirmed_brief: brief,
    findings: { title: "Onboarding pilot", sections: [] }, gaps: [], evidence });
  db.studio.seed(session, { ...studio_context(db, session).state, phase: "done" }, []);
  return research_id;
};

test("typed count queues once against the completed research and names the number", async () => {
  const { db, session, responses, service } = studio();
  const research_id = completed_research(db, session);
  responses.push({ reply: "Got it.", language: "en", actions: [{ kind: "prepare_slides", slide_count: 6 }] });
  let wakes = 0;
  const input: TStudioTurnInput = { input: "typed", turn_id: crypto.randomUUID(), message: "Make it 6 slides." };
  const dependencies = { ...service, wake_deck: () => { wakes++; } };
  const result = await run_studio_turn(db, session, input, dependencies);
  expect(result.text).toBe("Preparing 6 slides.");
  expect(result.activity).toMatchObject({ tool: "prepare_slides", status: "queued", deck_preparation: { research_id, slide_count: 6 } });
  expect(db.deck_preparations.active_for_research(session, research_id)).toEqual({ job_id: result.activity!.deck_preparation!.job_id!, slide_count: 6 });
  expect(await run_studio_turn(db, session, input, dependencies)).toEqual(result);
  expect(wakes).toBe(1);
});

test("deck commands before research finishes cannot queue or replace a research plan", async () => {
  const { db, session, responses, send } = studio();
  responses.push({ reply: "Preparing", language: "en", actions: [{ kind: "prepare_slides", slide_count: 6 }] });
  const result = await send("Make it 6 slides.");
  expect(result.text).toContain("Finish research");
  expect(result.activity).toBeUndefined();
  expect(db.deck_preparations.claim()).toBeUndefined();
  expect(studio_context(db, session).state.phase).toBe("interview");
});

test("voice decks use the same durable count and a typed edit waits for approval on the current revision", async () => {
  const { db, session, service, responses } = studio();
  const research_id = completed_research(db, session, [{ id: "M1", origin: "material", location: "Pilot readout", passage: "Pilot outcomes" }]);
  const voiced = await apply_voice_action(db, session, "Make four slides", { kind: "prepare_slides", slide_count: 4 }, service);
  expect(voiced.activity).toMatchObject({ tool: "prepare_slides", deck_preparation: { research_id, slide_count: 4 } });
  const deck_id = crypto.randomUUID();
  db.decks.create(session, { deck_id, research_id, revision: 1, title: "Pilot", slides: ["First", "Second"].map((title, index) =>
    ({ slide_id: String(index + 1), title, layout: "evidence", highlights: ["Pilot update"], narration: "A pilot update.", evidence_ids: [] })) },
  pitch_variant_key({ slide_count: 2 }));
  const message = "Change slide 2's title to Pilot outcomes.";
  responses.push({ reply: "I'll draft the change.", language: "en", actions: [{ kind: "revise_slide", slide_number: 2, instruction: message }] });
  const edit = await run_studio_turn(db, session, { input: "typed", turn_id: crypto.randomUUID(), message }, { ...service,
    deck_editor: async context => {
      expect(context.slide.slide_id).toBe("2");
      expect(context.message).toBe(message);
      return { kind: "edit", text: "Drafted", changes: { title: "Pilot outcomes" }, support: [{ evidence_id: "M1", excerpt: "Pilot outcomes" }] };
    } });
  const proposal = edit.activity!.deck_proposal!;
  expect(proposal).toMatchObject({ deck_id, slide_id: "2", status: "pending", base_revision: 1,
    attribution: [{ evidence_id: "M1", excerpt: "Pilot outcomes" }], after: { title: "Pilot outcomes", evidence_ids: ["M1"] } });
  expect(db.decks.get(session, deck_id)?.slides[1].title).toBe("Second");
  expect(db.decks.decide(session, deck_id, proposal.proposal_id, "approve").approved_revision).toBe(2);
  expect(db.decks.get(session, deck_id)?.slides[1].title).toBe("Pilot outcomes");
});

test("preview slide changes require exact citations and independent verification for new claims", async () => {
  const { db, session, service, responses } = studio();
  const research_id = completed_research(db, session, [{ id: "M1", origin: "material", location: "Pilot readout", passage: "The pilot is ongoing." }]);
  const deck_id = crypto.randomUUID();
  db.decks.create(session, { deck_id, research_id, revision: 1, title: "Pilot", slides: [{ slide_id: "s1", title: "Trial update",
    layout: "evidence", highlights: ["The pilot is ongoing."], narration: "The pilot is ongoing.", evidence_ids: ["M1"] }] }, pitch_variant_key({ slide_count: 1 }));
  const message = "Give slide one a more informative title.";
  const revise = { reply: "I'll draft the change.", language: "en", actions: [{ kind: "revise_slide", slide_number: 1, instruction: message }] } satisfies TAgentTurn;
  const try_edit = (excerpt: string) => {
    responses.push(revise);
    return run_studio_turn(db, session, { input: "typed", turn_id: crypto.randomUUID(), message }, { ...service,
      deck_editor: async () => ({ kind: "edit", text: "Drafted", changes: { title: "The pilot succeeded" }, support: [{ evidence_id: "M1", excerpt }] }),
      verify_deck_edit: async (claims, evidence) => {
        expect(claims.map(claim => claim.text)).toEqual(["The pilot succeeded"]);
        expect(evidence.map(item => item.passage)).toEqual(["The pilot is ongoing."]);
        return false;
      } });
  };
  const fabricated = await try_edit("The pilot succeeded");
  expect(fabricated.text).toContain("Which source");
  expect(fabricated.activity).toBeUndefined();
  const misleading = await try_edit("The pilot is ongoing.");
  expect(misleading.text).toContain("don’t verify");
  expect(misleading.activity).toBeUndefined();
  expect(db.decks.get(session, deck_id)?.revision).toBe(1);
});

test("opening greeting creates no proposal", async () => {
  const { responses, send, calls, jobs } = studio();
  responses.push({ reply: "Hi. What do you want to pitch?", language: "en", actions: [] });
  const reply = await send("Hello");
  expect(reply.phase).toBe("interview");
  expect(reply.proposal).toBeNull();
  expect(reply.text).toBe("Hi. What do you want to pitch?");
  expect(calls).toHaveLength(1);
  expect(jobs).toHaveLength(0);
});

test("propose then explicit typed approve queues one job without a second model call", async () => {
  const { db, session, propose, send, responses, calls, jobs } = studio();
  const proposal = (await propose()).proposal!;
  expect(proposal.urls).toEqual(["https://example.com/"]);
  responses.push(accepts);
  expect((await send("Yes")).phase).toBe("proposed");
  expect(jobs).toHaveLength(0);
  const approve = { input: "typed" as const, message: "Start research", turn_id: crypto.randomUUID(), option_id: "approve" as const, answer_to: proposal.proposal_id };
  const reply = await run_studio_turn(db, session, approve, { agent: async () => { throw new Error("No model needed"); }, ensure_research: () => {}, wake: id => { jobs.push(id); } });
  expect(reply.phase).toBe("researching");
  expect(reply.activity?.tool).toBe("queue_research");
  expect(db.current_brief(session)?.studio_notes).toEqual(["I led three regulated onboarding pilots."]);
  expect(db.current_brief(session)?.intent).toEqual({ ...pitch_intent, deliverable: "6 slides" });
  expect(db.current_brief(session)?.studio_version).toBe(2);
  expect(calls).toHaveLength(2);
  expect(jobs).toHaveLength(1);
  expect(db.missions.current(session)).toMatchObject({ status: "working", approved_revision: 1, research_job_id: jobs[0] });
});

test("typed scope revision freezes the old mission and cannot approve the replacement", async () => {
  const { db, session, propose, responses, send, jobs } = studio();
  const proposal = (await propose()).proposal!;
  await send("Start research", { option_id: "approve", answer_to: proposal.proposal_id });
  responses.push({ reply: "I'll start again.", language: "en", actions: [
    { kind: "mission_command", patch: { slide_count: 4, add_host_fact: "I use a secure sandbox", files_only: true } }, { kind: "start_research" },
  ] });
  const turn = await send("Make four slides, use only my files and add that I use a secure sandbox.");
  expect(turn.text).toContain("Review and approve");
  expect(db.missions.current(session)).toMatchObject({ status: "needs_approval", approved_revision: 1,
    contract: { revision: 2, deliverable: { slide_count: 4 }, sources: { public_search: false, urls: [], site_tasks: [] } } });
  expect(db.missions.current(session)?.contract.must_include.map(fact => fact.text)).toContain("I use a secure sandbox");
  expect(jobs).toHaveLength(1);
});

test("a typed patch arriving after a spoken mission revision cannot change the new plan", async () => {
  const { db, session, propose, service, jobs } = studio();
  await propose();
  const mission = db.missions.current(session)!;
  const basis = { mission_id: mission.mission_id, revision: mission.contract.revision };
  await expect(run_studio_turn(db, session, { input: "typed", turn_id: crypto.randomUUID(), message: "Make four slides" }, { ...service, agent: async () => {
    await apply_voice_action(db, session, "Make it seven slides", { kind: "mission_command", patch: { slide_count: 7 } }, service, basis);
    return { reply: "I’ll revise it.", language: "en", actions: [{ kind: "mission_command", patch: { slide_count: 4 } }] };
  } })).rejects.toThrow();
  expect(db.missions.current(session)).toMatchObject({ status: "needs_approval", contract: { revision: 2, deliverable: { slide_count: 7 } } });
  expect(jobs).toHaveLength(0);
});

test("spoken yes without heard proposal does not start research", async () => {
  const { db, session, propose, state, service, jobs } = studio();
  const offered = await propose();
  const basis_before_heard = { revision: studio_context(db, session).revision, proposal_id: offered.proposal!.proposal_id, proposal_heard: false };
  db.studio.hear_proposal(session, offered.proposal!.proposal_id, offered.turn_id);
  const reply = apply_studio_agent_turn(db, session, { input: "speech", message: "Yes", turn_id: crypto.randomUUID() }, accepts, service, basis_before_heard);
  expect(reply.phase).toBe("proposed");
  expect(reply.text).toContain("Shall I start?");
  expect(jobs).toHaveLength(0);
  expect(state().proposal_turn_id).toBe(reply.turn_id);
  expect(state().proposal_heard).toBe(false);
});

test("a heard plan starts on the agent's start call", async () => {
  const { db, session, propose, service, jobs } = studio();
  const offer = await propose();
  db.studio.hear_proposal(session, offer.proposal!.proposal_id, offer.turn_id);
  const basis = { revision: studio_context(db, session).revision, proposal_id: offer.proposal!.proposal_id, proposal_heard: true };
  const started = apply_studio_agent_turn(db, session, { turn_id: crypto.randomUUID(), message: "Yes, go ahead.", input: "speech" }, accepts, service, basis);
  expect([started.phase, jobs.length]).toEqual(["researching", 1]);
});
test("a new goal while proposed returns to interview and invalidates the old option", async () => {
  const { propose, send, responses, jobs } = studio();
  const offer = await propose();
  responses.push({ reply: "Who are you presenting to?", language: "en", actions: [{ kind: "remember", goal: "Partner alignment", notes: [] }] });
  expect((await send("Switch the pitch to partner alignment.")).phase).toBe("interview");
  await expect(send("Start research", { option_id: "approve", answer_to: offer.proposal!.proposal_id })).rejects.toThrow("no longer open");
  expect(jobs).toHaveLength(0);
});

test("a scope-only update invalidates the old approval without adding conversation turns", async () => {
  const { db, session, propose, send, jobs } = studio();
  const offer = await propose();
  const history = interview_workspace(session, db).history;
  update_studio_scope(db, session, { source_ids: [], source_policy: "files_only", urls: [], materials: "",
    expected_proposal_id: offer.proposal!.proposal_id });
  const workspace = interview_workspace(session, db);
  expect(workspace.phase).toBe("interview");
  expect(workspace.history).toEqual(history);
  expect(workspace.state.source_policy).toBe("files_only");
  await expect(send("Start research", { option_id: "approve", answer_to: offer.proposal!.proposal_id })).rejects.toThrow("no longer open");
  expect(jobs).toHaveLength(0);
});

test("start_research in interview is ignored", async () => {
  const { responses, send, jobs, db, session } = studio();
  responses.push(accepts);
  expect((await send("Start", { input: "speech" })).phase).toBe("interview");
  expect(jobs).toHaveLength(0);
  expect(db.current_brief(session)).toBeUndefined();
});

test("agent failure leaves state unchanged and records a retry reply", async () => {
  const { propose, send, state } = studio();
  await propose();
  const before = state();
  const reply = await send("What can we do next?", { materials: "Uncommitted material" });
  expect(reply.text).toBe("I couldn’t reach the AI model just now, so nothing changed. Please send that again.");
  expect(state()).toEqual(before);
});

test("replayed turn id returns the stored turn without another generation", async () => {
  const { responses, send, calls } = studio();
  responses.push({ reply: "What do you want to pitch?", language: "te", actions: [] });
  const turn_id = crypto.randomUUID();
  const one = await send("హలో", { turn_id });
  expect(await send("హలో", { turn_id })).toEqual(one);
  expect(calls).toHaveLength(1);
});

test("private file answers cite exact selected source records in the same turn", async () => {
  const { responses, send, calls, db, session } = studio();
  const source_id = crypto.randomUUID();
  db.sources.save(session, "pilot", { source_id, filename: "Pilot.pdf", kind: "pdf", locations: 1, gaps: [],
    records: [{ number: 2, text: "Pilot includes 24 buyers." }] });
  responses.push({ reply: "I checked the page.", language: "en", actions: [] });
  await send("Read the uploaded page.", { source_ids: [source_id] });
  expect(calls[0].evidence?.[0]).toMatchObject({ location: "Pilot.pdf, page 2", passage: "Pilot includes 24 buyers." });
  responses.push({ reply: "It includes buyers.", language: "en", actions: [],
    citations: [{ evidence_id: calls[0].evidence![0].id, excerpt: "Pilot includes 24 buyers." }] });
  const reply = await send("How many buyers?");
  expect(reply.activity?.citations?.[0]).toMatchObject({ excerpt: "Pilot includes 24 buyers.", location: "Pilot.pdf, page 2" });
  expect(interview_workspace(session, db).sources[0].source_id).toBe(source_id);
});

test("an explicit Telugu preference survives project reopen", async () => {
  const { responses, send, db, session } = studio();
  responses.push({ reply: "సరే, తెలుగులో మాట్లాడతాను.", language: "te", actions: [{ kind: "set_reply_language", language: "te" }] });
  await send("Reply in Telugu");
  expect(interview_workspace(session, db).state.reply_language).toBe("te");
});

test("saved replies are labelled with their own language", async () => {
  const { db, session, responses, send } = studio();
  responses.push({ reply: "సరే, తెలుగులో మాట్లాడతాను.", language: "te", actions: [{ kind: "set_reply_language", language: "te" }] });
  await send("Please speak Telugu with me.");
  responses.push({ reply: "Sure. What should the deck say first?", language: "en", actions: [] });
  expect((await send("What do you need from me first?")).language).toBe("en");
  const history = interview_workspace(session, db).history;
  expect(history.map(turn => turn.language)).toEqual([undefined, "te", undefined, "en"]);
});

test("a voice turn that began before the previous reply was saved is still recorded", async () => {
  const { responses, send, db, session } = studio();
  const before = { revision: studio_context(db, session).revision, proposal_id: null, proposal_heard: false };
  responses.push({ reply: "What are you pitching?", language: "en", actions: [] });
  await send("Hi");
  const saved = apply_studio_agent_turn(db, session, { turn_id: crypto.randomUUID(), message: "A book I wrote on applied AI.", input: "speech" },
    { reply: "Who is the book for?", language: "en", actions: [] }, { ensure_research: () => {}, wake: () => {} }, before);
  expect(saved.text).toBe("Who is the book for?");
  expect(interview_workspace(session, db).history.map(turn => turn.text)).toContain("A book I wrote on applied AI.");
});

test("a saved voice turn names the speech items it was built from", async () => {
  const { db, session } = studio();
  apply_studio_agent_turn(db, session, { turn_id: crypto.randomUUID(), message: "A book. On applied AI.", input: "speech" },
    { reply: "Who is it for?", language: "en", actions: [] }, { ensure_research: () => {}, wake: () => {} },
    { revision: 0, proposal_id: null, proposal_heard: false }, ["item_a", "item_b"]);
  const host = interview_workspace(session, db).history.find(turn => turn.role === "host");
  expect(host?.voice_items).toEqual(["item_a", "item_b"]);
});

const voice_services = (jobs: string[] = []) => ({ ensure_research: () => {}, wake: (id: string) => { jobs.push(id); } });

test("a spoken exchange is recorded word for word", () => {
  const { db, session, state } = studio();
  record_voice_exchange(db, session, { turn_id: crypto.randomUUID(), host: "నేను ఒక URL ఇస్తా: jk-ai.in", agent: "సరే. Shall I start?", voice_items: ["live:1200"] });
  const [host, agent] = interview_workspace(session, db).history;
  expect([host.text, agent.text, host.voice_items]).toEqual(["నేను ఒక URL ఇస్తా: jk-ai.in", "సరే. Shall I start?", ["live:1200"]]);
  expect(state().phase).toBe("interview");
});

test("a spoken plan is set without adding a turn, and only a fully heard plan can be approved by voice", () => {
  const { db, session, state } = studio();
  const jobs: string[] = [];
  record_voice_exchange(db, session, { turn_id: crypto.randomUUID(), host: "I led three onboarding pilots.", agent: "You could mention another pilot.", voice_items: ["live:1"] });
  const proposed = apply_voice_action(db, session, "Research jk-ai.in for a bank pitch about me.",
    { kind: "propose_research", goal: "Pitch JK AI's services to a bank", summary: "Review jk-ai.in for a bank pitch", queries: ["JK AI services"],
      urls: ["https://jk-ai.in/"], intent: pitch_intent,
      factual_notes: ["I led three onboarding pilots.", "You could mention another pilot.", "I led six pilots."] }, voice_services(jobs));
  expect(proposed.phase).toBe("proposed");
  expect(proposed.proposal?.urls).toEqual(["https://jk-ai.in/"]);
  expect(state().proposal_turn_id).toBe(proposed.turn_id);
  expect(interview_workspace(session, db).history).toHaveLength(2);
  // Not yet heard: refused, and the plan is to be read again under a new turn, which must itself be heard.
  const refused = apply_voice_action(db, session, "Yes, go ahead.", { kind: "start_research" }, voice_services(jobs));
  expect([refused.phase, state().proposal_turn_id, jobs.length]).toEqual(["proposed", refused.turn_id, 0]);
  db.studio.hear_proposal(session, refused.proposal!.proposal_id, refused.turn_id);
  const started = apply_voice_action(db, session, "Yes, go ahead.", { kind: "start_research" }, voice_services(jobs));
  expect([started.phase, started.activity?.tool, jobs.length]).toEqual(["researching", "queue_research", 1]);
  expect(db.current_brief(session)?.studio_notes).toEqual(["I led three onboarding pilots."]);
});

test("language names from the model are stored as tags the client accepts", async () => {
  const { language_tag } = await import("../src/services/studio-turn");
  expect(language_tag("english")).toBe("en");
  expect(language_tag("Telugu")).toBe("te");
  expect(language_tag("te-IN")).toBe("te-IN");
  expect(language_tag("klingonese")).toBeUndefined();
  expect(language_tag("")).toBeUndefined();
});
