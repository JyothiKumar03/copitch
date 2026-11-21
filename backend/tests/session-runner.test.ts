import { APICallError } from "ai";
import type { TAttempt } from "../src/types/ai";
import { expect, test } from "bun:test";
import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test";
import { SessionStore } from "../src/repositories/session";
import { create_model_step } from "../src/services/ai-sdk";
import { configured_models } from "../src/services/model-config";
import { SessionRunner } from "../src/services/session-runner";
import type { TSessionEvent } from "../src/types/session";

const config = JSON.stringify([{
  provider: "openai", model: "fixture", max_output_tokens: 321, temperature: 0.2, tool_providers: ["session"],
  pricing: { input: 2, cached_input: 1, output: 4, version: "test-only" },
}]);
const usage = {
  inputTokens: { total: 12, noCache: 10, cacheRead: 2, cacheWrite: 0 },
  outputTokens: { total: 4, reasoning: 0, text: 4 },
};

test("session executes correlated tools, streams text, and records each billed step", async () => {
  const model = new MockLanguageModelV4({ doStream: [
    { stream: convertArrayToReadableStream([
      { type: "tool-call", toolCallId: "a", toolName: "find_context", input: '{"phrase":"north"}' },
      { type: "tool-call", toolCallId: "b", toolName: "read_context", input: '{"offset":2}' },
      { type: "finish", usage, finishReason: { unified: "tool-calls", raw: "tool_calls" } },
    ]) },
    { stream: convertArrayToReadableStream([
      { type: "text-start", id: "text" }, { type: "text-delta", id: "text", delta: "North." },
      { type: "text-end", id: "text" }, { type: "finish", usage, finishReason: { unified: "stop", raw: "stop" } },
    ]) },
  ] });
  const db = new SessionStore(":memory:");
  db.add_session("host", "hash");
  const id = db.start("host", "Where?", "go north")!;
  const step = create_model_step(configured_models(config), { openai: name => {
    expect(name).toBe("fixture");
    return model;
  } });
  await new SessionRunner("host", db, step).execute(id, new AbortController().signal);
  expect(db.get("host", id)?.status).toBe("completed");
  expect(db.get("other", id)).toBeNull();
  expect(model.doStreamCalls).toHaveLength(2);
  const [first, second] = model.doStreamCalls;
  expect(first.maxOutputTokens).toBe(321);
  expect(first.temperature).toBe(0.2);
  expect(first.tools?.map(tool => tool.name)).toEqual(["read_context", "find_context"]);
  const tool_messages = second.prompt.filter(message => message.role === "tool");
  expect(JSON.stringify(tool_messages)).toContain('"offset":3');
  expect(JSON.stringify(tool_messages)).toContain('"excerpt":" north"');
  expect(JSON.stringify(tool_messages)).toContain('"toolCallId":"a"');
  expect(JSON.stringify(tool_messages)).toContain('"toolCallId":"b"');
  const events = db.events(id, 0).map(row => JSON.parse(row.event) as TSessionEvent);
  expect(events.filter(event => event.type === "attempt").map(event => event.attempt.estimated_usd)).toEqual([0.000038, 0.000038]);
  expect(events).toContainEqual({ type: "text", text: "North." });
  expect(events.at(-1)).toEqual({ type: "done" });
});

test("model config rejects unsupported providers, limits and tool mappings", () => {
  for (const [field, value] of [["provider", "unknown"], ["max_output_tokens", 0], ["tool_providers", ["unregistered"]]]) {
    expect(() => configured_models(JSON.stringify([{ ...JSON.parse(config)[0], [field as string]: value }]))).toThrow();
  }
});

test("a model with disabled tools sees no executors and follow-up turns keep prior evidence", async () => {
  const db = new SessionStore(":memory:");
  db.add_session("host", "hash");
  const previous = db.start("host", "Summarize", "fixture evidence")!;
  db.checkpoint(previous, 1, [{ role: "assistant", content: "Summary" }]);
  db.finish(previous, { type: "done" });
  const current = db.start("host", "Which source?", "")!;
  const model = new MockLanguageModelV4({ doStream: {
    stream: convertArrayToReadableStream([
      { type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "The fixture." },
      { type: "text-end", id: "t" }, { type: "finish", usage, finishReason: { unified: "stop", raw: "stop" } },
    ]),
  } });
  const [candidate] = configured_models(config);
  const step = create_model_step([{ ...candidate, tool_providers: [], pricing: undefined }], { openai: () => model });
  await new SessionRunner("host", db, step).execute(current, new AbortController().signal);
  expect(db.get("host", current)?.status).toBe("completed");
  const [call] = model.doStreamCalls;
  expect(call.tools ?? []).toHaveLength(0);
  expect(JSON.stringify(call.prompt)).toContain("fixture evidence");
  const events = db.events(current, 0).map(row => JSON.parse(row.event) as TSessionEvent);
  expect(events.find(event => event.type === "attempt")?.attempt.estimated_usd).toBeNull();
});

test("a retryable pre-output failure falls through to the next configured model", async () => {
  const first = new MockLanguageModelV4({ doStream: async () => { throw new APICallError({
    message: "Busy", url: "https://fixture.invalid", requestBodyValues: {}, statusCode: 503,
  }); } });
  const second = new MockLanguageModelV4({ doStream: {
    stream: convertArrayToReadableStream([
      { type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "OK" },
      { type: "text-end", id: "t" }, { type: "finish", usage, finishReason: { unified: "stop", raw: "stop" } },
    ]),
  } });
  const [candidate] = configured_models(config);
  const step = create_model_step([candidate, { ...candidate, model: "second", max_output_tokens: 42 }], {
    openai: model => model === "second" ? second : first,
  });
  const attempts: TAttempt[] = [];
  let reply = "";
  await step({
    messages: [{ role: "user", content: "hello" }], tool_providers: {}, signal: new AbortController().signal,
    on_text: text => { reply += text; }, on_attempt: attempt => attempts.push(attempt),
  });
  expect(reply).toBe("OK");
  expect(attempts.map(attempt => [attempt.model, attempt.outcome])).toEqual([["fixture", "failed"], ["second", "completed"]]);
  expect(second.doStreamCalls[0].maxOutputTokens).toBe(42);
});
