import { expect, test } from "bun:test";
import { MockLanguageModelV3 } from "ai/test";
import { create_studio_agent } from "../src/services/studio-agent";
import { parse_state } from "../src/types/studio-turn";

const model_reply = (text: Record<string, unknown>) => new MockLanguageModelV3({
  doGenerate: {
    content: [{ type: "text", text: JSON.stringify({ slide_count: null, deck_focus: null, slide_number: null, slide_instruction: null, mission_patch: null, ...text }) }],
    finishReason: { unified: "stop", raw: "stop" }, warnings: [],
    usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 20, text: 20, reasoning: 0 } },
  },
});

test("the typed agent translates a direct count into one validated deck command", async () => {
  const model = model_reply({ reply: "I can prepare four slides.", language: "en", factual_notes: [], suggested_goal: null, language_preference: null,
    citations: [], intent: "prepare_slides", plan: null, slide_count: 4 });
  const result = await create_studio_agent(model)({ message: "Make it 4 slides", history: [],
    state: { ...parse_state(null, true), phase: "done" }, files: [], job_status: "completed" }, AbortSignal.timeout(1000));
  expect(result.actions).toEqual([{ kind: "prepare_slides", slide_count: 4 }]);
  expect(model.doGenerateCalls).toHaveLength(1);
});

test("one strict response supplies a language, reply and proposal without a second tool generation", async () => {
  const model = model_reply({ reply: "ఇది మా పైలట్ ప్రణాళిక. ప్రారంభించనా?", language: "te",
    factual_notes: ["I led a bank pilot."], suggested_goal: null, language_preference: null,
    citations: [], intent: "plan", plan: { subject: "Bank pilot", audience: "Operations team", outcome: "Pilot approval", deliverable: "A short pitch",
      summary: "Review the bank pilot", queries: ["bank pilot"], urls: [] } });
  const result = await create_studio_agent(model)({ message: "బ్యాంక్ పైలట్ గురించి పిచ్ చేయాలి. I led a bank pilot.", history: [], state: parse_state(null, false), files: [], job_status: null },
    AbortSignal.timeout(1000));
  expect(result.language).toBe("te");
  expect(result.actions.map(action => action.kind)).toEqual(["remember", "propose_research"]);
  expect(result.actions[0]).toMatchObject({ notes: ["I led a bank pilot."] });
  expect(model.doGenerateCalls).toHaveLength(1);
  expect(model.doGenerateCalls[0].tools).toBeUndefined();
  expect(JSON.stringify(model.doGenerateCalls[0].responseFormat)).not.toContain('"oneOf"');
});

test("a research-phase plan in the provider reply cannot become an action", async () => {
  const model = model_reply({ reply: "Research is running.", language: "en", factual_notes: [], suggested_goal: null, language_preference: null,
    citations: [], intent: "plan", plan: { subject: "Replace job", audience: "Host", outcome: "Replacement", deliverable: "A plan", summary: "Replace the active job", queries: [], urls: [] } });
  const result = await create_studio_agent(model)({
    message: "How's it going?", history: [], state: { ...parse_state(null, false), phase: "researching" }, files: [], job_status: "running",
  }, AbortSignal.timeout(1000));
  expect(result.actions).toEqual([]);
  expect(result.reply).toBe("Research is running.");
});

test("an explicit scope change becomes one proposed mission patch while research is running", async () => {
  const model = model_reply({ reply: "Review the changed plan.", language: "en", factual_notes: [], suggested_goal: null, language_preference: null,
    citations: [], intent: "mission_command", plan: null,
    mission_patch: { slide_count: 4, audience: null, purpose: null, tone: null, add_host_fact: null, files_only: true } });
  const input = { message: "Make four slides and use only my files", history: [], state: { ...parse_state(null, false), phase: "researching" as const },
    files: [], job_status: "running", mission: { status: "working" as const, slide_count: 6, audience: "Bank", purpose: "Approve a pilot" } };
  expect((await create_studio_agent(model)(input, AbortSignal.timeout(1000))).actions).toEqual([
    { kind: "mission_command", patch: { slide_count: 4, files_only: true } },
  ]);
  const unaffiliated = { ...input, mission: undefined };
  expect((await create_studio_agent(model)(unaffiliated, AbortSignal.timeout(1000))).actions).toEqual([]);
});

test("a greeting cannot replace an open goal, and Telugu reply tags follow the written text", async () => {
  const model = model_reply({
    reply: "నమస్కారం! మీ ప్రణాళిక సిద్ధంగా ఉంది.", language: "en", factual_notes: [],
    suggested_goal: "Start over", language_preference: null, citations: [], intent: "conversation", plan: null,
  });
  const result = await create_studio_agent(model)({
    message: "నమస్కారం!", history: [], state: { ...parse_state(null, false), phase: "proposed", goal: "Bank pilot" },
    files: [], job_status: null,
  }, AbortSignal.timeout(1000));
  expect(result.language).toBe("te");
  expect(result.actions).toEqual([]);
});
