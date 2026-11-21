import { SessionStore } from "../../backend/src/repositories/session";
import { studio_agent } from "../../backend/src/services/studio-agent";
import { run_studio_turn, studio_context, update_studio_scope } from "../../backend/src/services/studio-turn";

const db = new SessionStore(":memory:");
const services = { agent: studio_agent, ensure_research: () => { throw new Error("Eval cannot start research"); }, wake: () => {} };
const send = (session: string, message: string) => run_studio_turn(db, session, {
  input: "typed", turn_id: crypto.randomUUID(), message, source_policy: "files_only",
}, services);

const english = crypto.randomUUID();
const opening = await send(english, "Hello!");
const vague = await send(english, "I'd like to pitch myself.");
const vague_goal = studio_context(db, english).state.goal;
const detail = await send(english, "Make a pitch about my onboarding pilot for bank directors. I want them to approve a 30-day trial. I led two onboarding pilots.");
const greeting = await send(english, "Hello again!");
const telugu = await send(crypto.randomUUID(), "నమస్కారం. నేను ఒక ఉత్పత్తి గురించి పిచ్ చేయాలనుకుంటున్నాను.");
const introduction = crypto.randomUUID();
const early_introduction = [];
for (const message of ["Hello!", "I want to pitch about myself.", "My team.", "Nothing. What will they do?"]) {
  early_introduction.push(await send(introduction, message));
}
const early_goal = studio_context(db, introduction).state.goal;
const source_id = crypto.randomUUID();
db.sources.save(introduction, "portfolio", { source_id, filename: "portfolio.csv", kind: "csv", locations: 2, gaps: [],
  records: [{ number: 2, text: "Week 1: 12 pilot signups" }, { number: 3, text: "Week 2: 18 pilot signups" }] });
update_studio_scope(db, introduction, { source_ids: [source_id], source_policy: "files_only", urls: [], materials: "", expected_proposal_id: null });
await send(introduction, "I led the onboarding pilot and delivered two training sessions. This is a five-minute introduction to my new project team so they know my role and experience. They do not need to decide anything. Use my attached portfolio CSV to mention what the pilot tracked.");
const introduction_plan = await send(introduction, "Please show me the research plan for that introduction now.");
const restored_intro = studio_context(db, introduction).state;

const checks = [
  ["opening", /what.*pitch/i.test(opening.text) && !/listening|audience/i.test(opening.text)],
  ["vague_self", vague.phase === "interview" && !/^(?:myself|me)$/i.test(vague_goal ?? "") && vague.text.includes("?")],
  ["proposes", detail.phase === "proposed" && !!detail.proposal && /30.day|trial/i.test(detail.proposal.summary)],
  ["files_only", detail.proposal?.source_policy === "files_only" && detail.proposal.queries.length === 0],
  ["mid_greeting", greeting.phase === "proposed" && !/what do you want to pitch/i.test(greeting.text)],
  ["telugu_turn", telugu.language.startsWith("te")],
  ["no_echo", [opening, vague, detail, greeting].every(reply => !/Pitch:|Audience:/i.test(reply.text))],
  ["vague_introduction_stays_open", early_introduction.every(reply => reply.phase === "interview" && !reply.proposal)],
  ["informational_plan", introduction_plan.phase === "proposed" && introduction_plan.proposal?.source_policy === "files_only" &&
    /introduction|intro/i.test(introduction_plan.proposal.summary) && !db.current_brief(introduction)],
  ["informational_context", restored_intro.source_ids.includes(source_id) &&
    !!restored_intro.factual_notes?.some(note => /led the onboarding pilot|training sessions/i.test(note))],
];
for (const [name, passed] of checks) console.log(passed ? "PASS" : "FAIL", name);
if (checks.some(([, passed]) => !passed)) {
  const describe = (turn: typeof opening) => ({ phase: turn.phase, reply: turn.text, plan: turn.proposal?.summary });
  console.log(JSON.stringify({ opening: describe(opening), detail: describe(detail), greeting: describe(greeting), early_introduction: early_introduction.map(describe),
    early_goal, introduction_plan: describe(introduction_plan),
    introduction_notes: restored_intro.factual_notes }));
  process.exitCode = 1;
}
