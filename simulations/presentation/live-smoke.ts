// Opt-in provider rehearsal. This uses an in-memory database, a synthetic account, and the configured private voice service.
import assert from "node:assert/strict";
import { serve_api } from "../../backend/tests/helpers/serve-api";
import { database } from "../../backend/src/repositories/store";
import { pitch_markdown } from "../../backend/src/services/pitch-markdown";
import type { TResearchBundle } from "../../backend/src/types/research";

if (!process.env.OPENAI_API_KEY || !process.env.VOICE_WORKER_TOKEN) throw Error("Configure the provider and start the private voice service before rehearsal.");
process.env.AI_SESSION_DB = ":memory:";
const { default: app } = await import("../../backend/src/app");
await using http = await serve_api(app);
const auth = await http.request("/api/account/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
  email: `module-two-live-${crypto.randomUUID()}@example.test`, password: crypto.randomUUID(),
}) });
assert.ok(auth.ok, `sign-up ${auth.status}`);
const cookie = auth.headers.get("set-cookie")!.split(";", 1)[0];
const send = async (path: string, body?: unknown, token?: string) => {
  const response = await http.request(path, {
    method: body === undefined ? "GET" : "POST", signal: AbortSignal.timeout(60_000),
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : { Cookie: cookie }), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return response;
};
const json = async (path: string, body?: unknown, token?: string) => {
  const result = await send(path, body, token);
  if (!result.ok) throw Error(`${path} ${result.status} ${await result.text()}`);
  return result.json();
};

const project = await json("/api/projects", { name: "Presentation live rehearsal" });
const session = project.session_id;
const base = `/api/sessions/${session}`;
const brief = { brief_id: crypto.randomUUID(), summary: "Present the pilot results to operations and discuss implications.", question: null,
  public_queries: [], urls: [], source_policy: "files_only" as const, materials: "", messages: [], studio_version: 2 as const,
  intent: { subject: "The onboarding pilot", audience: "Operations", outcome: "Understand the pilot", deliverable: "Presentation" } };
const lines = ["The onboarding pilot took place in Hyderabad over four weeks.",
  "Twenty-four teams joined the pilot and eighteen completed the checklist.", "The pilot was observational and had no comparison group."];
const evidence = lines.map((passage, index) => ({ id: `M${index + 1}`, passage, location: `Pilot note ${index + 1}`, origin: "material" as const }));
const support = evidence.map(record => [{ evidence_id: record.id, excerpt: record.passage }]);
const bundle: TResearchBundle = { research_id: crypto.randomUUID(), brief_id: brief.brief_id, confirmed_brief: brief, markdown: lines.join("\n\n"),
  findings: { title: "Onboarding pilot", sections: ["Pilot setting", "Participation", "Interpretation"].map((heading, i) => ({ heading,
    paragraphs: [{ prose: lines[i], support: support[i] }],
  })) }, evidence, gaps: [], grounding: { version: 1, mode: "verified" }, pitch_script: [
    { purpose: "opening", prose: lines[0], support: support[0] },
    { purpose: "point", prose: lines[1], support: support[1] },
    { purpose: "close", prose: lines[2], support: support[2] },
  ] };
bundle.pitch_markdown = pitch_markdown(bundle);
const db = database();
db.replace_brief(session, undefined, brief);
const job = db.research_jobs.enqueue(session, brief.brief_id);
db.research_jobs.complete(db.research_jobs.claim(job.job_id)!, bundle);

const deck = await json(`${base}/decks`, { research_id: bundle.research_id, pitch: { audience: "Operations leaders", duration_minutes: 2, slide_count: 3 } });
assert.ok(deck.slides.length >= 2);
assert.ok(deck.slides.every((slide: { sentences?: unknown[] }) => slide.sentences?.length));
console.log(JSON.stringify({ phase: "planned", slides: deck.slides.length, templates: deck.slides.map((slide: { template?: {type:string} }) => slide.template?.type) }));
const live = `${base}/decks/${deck.deck_id}/live`;
let { state, stage } = await json(`${live}/start`, { revision: deck.revision, approved: true });
assert.equal(state.status, "awaiting_paint");
assert.equal(state.attempt, null);
let view = await json("/api/audience", undefined, stage.token);
assert.equal(view.slide.slide_id, state.cursor.slide_id);
assert.ok(!("narration" in view.slide) && !("sentences" in view.slide));
const paint = async () => {
  view = await json("/api/audience", undefined, stage.token);
  const result = await send("/api/audience/paint", { sequence: view.sequence, revision: view.revision, slide_id: view.slide.slide_id }, stage.token);
  if (!result.ok) throw Error(`paint ${result.status} ${await result.text()}`);
  state = await json(live);
};
const command = async (action: object) => {
  state = await json(`${live}/commands`, { event_id: crypto.randomUUID(), revision: state.revision, generation: state.generation, action });
};
const fetchAudio = async () => {
  assert.ok(state.attempt);
  const blob = await send(`${live}/audio/${state.attempt.attempt_id}`);
  if (!blob.ok) throw Error(`Audio request failed with ${blob.status}: ${await blob.text()}`);
  assert.match(blob.headers.get("content-type") ?? "", /audio\/mpeg/);
  const size = (await blob.arrayBuffer()).byteLength;
  assert.ok(size > 512);
  return size;
};
await paint();
const heartbeat = setInterval(() => {
  void send("/api/audience/paint", { sequence: view.sequence, revision: view.revision, slide_id: view.slide.slide_id }, stage.token).catch(() => {});
}, 2000);
heartbeat.unref();
assert.equal(state.status, "narrating");
const initial_cursor = state.cursor;
const attempt = state.attempt.attempt_id;
const audio_bytes = await fetchAudio();
await command({ kind: "playing", attempt_id: attempt });
await command({ kind: "interrupt", attempt_id: attempt });
assert.deepEqual(state.cursor, initial_cursor);
assert.equal((await send(`${live}/audio/${attempt}`)).status, 409);
const voice = (process.env.VOICE_WORKER_URL ?? "http://127.0.0.1:8900").replace(/\/$/u, "");
const recording = await fetch(`${voice}/speech`, { method: "POST", signal: AbortSignal.timeout(45_000),
  headers: { Authorization: `Bearer ${process.env.VOICE_WORKER_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ text: "Where did this pilot take place?", language: "en" }),
});
assert.ok(recording.ok, `synthetic question audio ${recording.status}`);
const form = new FormData();
form.set("audio", await recording.blob(), "question.mp3");
const recognized = await http.request(`${base}/interview/transcribe`, { method: "POST", signal: AbortSignal.timeout(45_000),
  headers: { Cookie: cookie }, body: form });
assert.ok(recognized.ok, `question transcript ${recognized.status}`);
const { text: question } = await recognized.json();
assert.match(question, /pilot.+take place/iu);
state = await json(`${live}/turns`, { turn_id: crypto.randomUUID(), pin_id: state.pin.pin_id, message: question });
assert.equal(state.last_reply.kind, "answer", JSON.stringify(state.last_reply));
assert.match(state.last_reply.text, /Hyderabad/i);
assert.ok(state.last_reply.citations.length > 0);
const answer_bytes = await fetchAudio();
const answer = state.attempt.attempt_id;
await command({ kind: "playing", attempt_id: answer });
await command({ kind: "ended", attempt_id: answer });
assert.deepEqual(state.cursor, initial_cursor);
console.log(JSON.stringify({ phase: "interrupted_answer_and_resumed", audio_bytes, answer_bytes,
  live_transcription: true, citations: state.last_reply?.citations?.length ?? 0 }));

await command({ kind: "interrupt", attempt_id: state.attempt.attempt_id });
state = await json(`${live}/turns`, { turn_id: crypto.randomUUID(), pin_id: state.pin.pin_id,
  message: "Add this fact to the current slide: 6 participating teams were repeat customers." });
assert.equal(state.status, "awaiting_decision", JSON.stringify(state.last_reply));
assert.ok(state.proposal);
assert.equal(state.proposal.before.slide_id, initial_cursor.slide_id);
const oldView = await json("/api/audience", undefined, stage.token);
assert.equal(oldView.revision, deck.revision);
const approve = { event_id: crypto.randomUUID(), revision: state.revision, generation: state.generation,
  action: { kind: "decide", proposal_id: state.proposal.proposal_id, slide_id: state.proposal.slide_id, decision: "approve" } };
state = await json(`${live}/commands`, approve);
assert.equal(state.revision, deck.revision + 1);
assert.equal(state.cursor.slide_id, initial_cursor.slide_id);
assert.equal((await json(`${live}/commands`, approve)).revision, state.revision);
await paint();
while (state.attempt?.kind === "accepted_edit") {
  const id = state.attempt.attempt_id;
  await command({ kind: "playing", attempt_id: id });
  await command({ kind: "ended", attempt_id: id });
}
assert.notEqual(state.cursor.slide_id, initial_cursor.slide_id);
assert.equal(state.status, "awaiting_paint");
console.log(JSON.stringify({ phase: "applied_once_then_advanced_after_paint", revision: state.revision, stage_sequence: state.stage_sequence }));
clearInterval(heartbeat);
