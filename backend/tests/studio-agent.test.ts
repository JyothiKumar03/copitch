import { expect, test } from "bun:test";
import { MockLanguageModelV3 } from "ai/test";
import { create_studio_agent } from "../src/services/studio-agent";
import { parse_state } from "../src/types/studio-turn";

const model_reply = (text: unknown) => new MockLanguageModelV3({
  doGenerate: {
    content: [{ type: "text", text: JSON.stringify(text) }], finishReason: { unified: "stop", raw: "stop" }, warnings: [],
    usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 20, text: 20, reasoning: 0 } },
  },
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
