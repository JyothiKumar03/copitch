import { expect, test } from "bun:test";
import { SessionStore } from "../src/repositories/session";
import { apply_voice_action } from "../src/services/studio-turn";
import { studio_outcome } from "../src/services/director";
import { initial_studio_context } from "../src/services/studio-state";

const reported_subject = "a six-slide introduction about Jyothi Kumar for a new team, using the public portfolio jk-ai dot in and including two personal details";
const spoken = [
  "My name is Jyothi Kumar.", "Use my public portfolio, jk-ai dot in.", "Include two personal details.",
  "I love classical music.", "I love mangoes.",
];
const make_contract = (subject: string, notes: string[], messages: string[]) => {
  const state = initial_studio_context();
  state.goal = subject;
  state.factual_notes = notes;
  state.proposal = { proposal_id: crypto.randomUUID(), summary: subject, urls: ["https://jk-ai.in/"], queries: [],
    source_policy: "public_search", intent: { subject, audience: "new teammates", outcome: "Get to know the presenter.", deliverable: "Six-slide deck" } };
  return studio_outcome(state,messages)!;
};

test("the spoken introduction contract keeps the named subject and quoted facts apart from source and content directions", () => {
  const contract = make_contract(reported_subject,spoken,[spoken.join(" ")]);
  expect(contract.subject).toBe("Jyothi Kumar");
  expect(contract.must_include).toEqual([spoken[0],spoken[3],spoken[4]].map(text => ({source:"host",text})));
  expect(contract.sources.urls).toEqual(["https://jk-ai.in/"]);
  expect(contract.deliverable.slide_count).toBe(6);
});

test("a presenter naming themselves does not change a product subject, and first-person use statements remain quoted", () => {
  const notes = ["My name is Jyothi Kumar.", "I use a secure sandbox.", "I use a secure sandbox.", "Use of encryption increased."];
  const contract = make_contract("A six-slide introduction about Atlas for new colleagues",notes,[notes.join(" ")]);
  expect(contract.subject).toBe("A six-slide introduction about Atlas for new colleagues");
  expect(contract.must_include.map(fact => fact.text)).toEqual([notes[0],notes[1],notes[3]]);
});

test("embedded factual quotations keep the host wording and an instruction to include a source stays out", () => {
  const notes = ["Include my portfolio.", "Please add that I use SQL every day.", "Research shows demand increased."];
  const contract = make_contract("Project overview",notes,[...notes,"Use this deck for onboarding."]);
  expect(contract.must_include.map(fact => fact.text)).toEqual(["I use SQL every day.","Research shows demand increased."]);
  expect(contract.subject).toBe("Project overview");
});

test("a name from the proposed plan alone cannot override the subject", () => {
  const host = "Build a six-slide introduction.";
  expect(make_contract(reported_subject,spoken,[host]).subject).toBe(reported_subject);
  expect(make_contract(reported_subject,spoken,[host]).must_include).toEqual([]);
});

test("voice proposal, heard readback and approved research keep the same three H notes and subject", async () => {
  const db = new SessionStore(":memory:");
  const session = crypto.randomUUID();
  const services = { ensure_research: () => {}, wake: () => {} };
  const message = [...spoken,"Make a fun six-slide introduction for my new teammates."].join(" ");
  const turn = await apply_voice_action(db,session,message,{
    kind: "propose_research", goal: reported_subject, summary: reported_subject, factual_notes: spoken,
    intent: { subject: reported_subject, audience: "new teammates", outcome: "Meet their teammate.", deliverable: "six-slide introduction" },
    urls: ["https://jk-ai.in/"], queries: [],
  },services);
  expect(turn.mission_readback?.text).toContain("about Jyothi Kumar.");
  expect(turn.mission_readback?.text).not.toContain("Include two personal details.");
  db.studio.hear_proposal(session,turn.proposal!.proposal_id,turn.turn_id);
  await apply_voice_action(db,session,"Yes, go ahead.",{kind:"start_research"},services);
  const brief = db.current_brief(session)!;
  expect(brief.intent?.subject).toBe("Jyothi Kumar");
  expect(brief.studio_notes).toEqual([spoken[0],spoken[3],spoken[4]]);
  expect(brief.urls).toEqual(["https://jk-ai.in/"]);
});

test("a combined voice note retains factual sentences alongside a portfolio direction", () => {
  const note = "I use a secure sandbox. Use my public portfolio. I love mangoes.";
  expect(make_contract("Meet the team",[note],[note]).must_include.map(fact => fact.text)).toEqual([
    "I use a secure sandbox.", "I love mangoes.",
  ]);
});
