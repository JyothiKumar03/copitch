import { expect, test } from "bun:test";
import { SessionStore } from "../src/repositories/session";
import { interview_workspace } from "../src/services/interview";
import { apply_studio_agent_turn, apply_voice_action, record_voice_exchange, run_studio_turn, studio_context, update_studio_scope } from "../src/services/studio-turn";
import type { TStudioAgent, TStudioAgentInput } from "../src/services/studio-agent";
import type { TAgentTurn, TStudioTurnInput } from "../src/types/studio-turn";

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
  expect(db.current_brief(session)?.intent).toEqual(pitch_intent);
  expect(db.current_brief(session)?.studio_version).toBe(2);
  expect(calls).toHaveLength(2);
  expect(jobs).toHaveLength(1);
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
  expect(reply.text).toBe("Sorry, I lost that. Could you say it again?");
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

test("a turn is labelled with the language its reply is written in", async () => {
  const { responses, send } = studio();
  responses.push({ reply: "సరే, తెలుగులో మాట్లాడతాను.", language: "te", actions: [{ kind: "set_reply_language", language: "te" }] });
  await send("Please speak Telugu with me.");
  responses.push({ reply: "Sure. What should the deck say first?", language: "en", actions: [] });
  expect((await send("What do you need from me first?")).language).toBe("en");
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
