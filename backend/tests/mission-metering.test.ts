import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test";
import { create_model_step } from "../src/services/ai-sdk";
import { decide_presentation_readiness } from "../src/services/presentation-readiness";
import type { TResearchBundle } from "../src/types/research";
import { MissionRepository } from "../src/repositories/mission";
import { metered_model, with_mission_job, with_mission_meter } from "../src/services/mission-metering";
import { research_provider } from "../src/services/research-provider";
import type { TModelCandidate } from "../src/types/ai";

const candidate: TModelCandidate = { model: "gpt-4o-mini", provider: "openai", max_output_tokens: 1000,
  tool_providers: [], pricing: { input: 1, cached_input: 0.5, output: 1000, version: "fixture" } };

const setup = () => {
  const db = new Database(":memory:");
  const repo = new MissionRepository(db);
  const session = "session";
  const mission = repo.proposal(session, { contract_id: crypto.randomUUID(), revision: 1, subject: "Fixture",
    purpose: "Fixture", audience: "Fixture", deliverable: { kind: "deck", slide_count: 2 }, must_include: [],
    sources: { urls: [], files: [], site_tasks: [], public_search: false }, success_checks: [], budget: { usd: 2, minutes: 10 } }, "proposal");
  mission.status = "working";
  mission.approved_revision = 1;
  mission.started_at = Date.now();
  repo.save(session, mission);
  repo.bind(session, mission, "child");
  return { repo, mission, db, meter: repo.mission_meter(session, "child")!, read: () => repo.get(session, mission.mission_id) };
};

const reply = () => Response.json({ id: "resp_1", model: candidate.model, created_at: 1, status: "completed",
  output: [{ type: "message", id: "msg", role: "assistant", content: [{ type: "output_text", text: "ok", annotations: [] }] }],
  usage: { input_tokens: 40, input_tokens_details: { cached_tokens: 10 }, output_tokens: 20 } });

test("overlapping child calls reserve the effective output cap before dispatch and credit reported token usage once", async () => {
  const { db, meter, read } = setup();
  const release = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  let sent = 0;
  const openai = createOpenAI({ apiKey: "fixture", fetch: async () => {
    sent++;
    entered.resolve();
    await release.promise;
    return reply();
  } });
  const run = () => with_mission_meter(meter, () => generateText({ model: metered_model(candidate, openai.responses(candidate.model)),
    maxRetries: 0, maxOutputTokens: 1050, prompt: "fixture" }));
  try {
    const first = run();
    await entered.promise;
    expect(read().reserved_usd).toBeGreaterThan(1.05);
    await expect(run()).rejects.toThrow("budget");
    expect(sent).toBe(1);
    release.resolve();
    await first;
    expect(read().reserved_usd).toBe(0);
    expect(read().spent_usd).toBeCloseTo(0.020035, 8);
  } finally { release.resolve(); db.close(); }
});

test("unpriced calls stop before transport, manual jobs bypass mission metering, unknown billing keeps the reservation", async () => {
  const { db, meter, read } = setup();
  let sent = 0;
  const openai = createOpenAI({ apiKey: "fixture", fetch: async () => { sent++; throw new Error("disconnected"); } });
  const run = (config: TModelCandidate) => generateText({ model: metered_model(config, openai.responses(candidate.model)),
    maxRetries: 0, maxOutputTokens: 10, prompt: "fixture" });
  try {
    await expect(with_mission_meter(meter, () => run({ ...candidate, pricing: undefined }))).rejects.toThrow("spending bound");
    expect(sent).toBe(0);
    await expect(run({ ...candidate, pricing: undefined })).rejects.toThrow();
    expect(sent).toBe(1);
    expect(read().reserved_usd).toBe(0);
    await expect(with_mission_meter(meter, () => run(candidate))).rejects.toThrow();
    expect(read().reserved_usd).toBeGreaterThan(0);
    expect(read().spent_usd).toBe(0);
  } finally { db.close(); }
});

test("a hosted search reserves every allowed action and charges its completed fixed billing block", async () => {
  const { db, meter, read } = setup();
  const openai = createOpenAI({ apiKey: "fixture", fetch: async () => {
    expect(read().reserved_usd).toBeGreaterThan(1.036);
    return Response.json({ id: "resp", model: candidate.model, created_at: 1, status: "completed",
      output: [{ type: "web_search_call", id: "ws", status: "completed", action: { type: "search", query: "fixture" } }],
      usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 0 }, output_tokens: 10 } });
  } });
  const provider = research_provider(candidate, openai);
  try {
    await with_mission_meter(meter, () => provider.lookup("fixture", undefined, AbortSignal.timeout(1000)));
    expect(read().spent_usd).toBeCloseTo(0.0281, 8);
    expect(read().reserved_usd).toBe(0);
  } finally { db.close(); }
});

test("stopping the mission aborts a pending child and rejects subsequent dispatch", async () => {
  const { db, repo, mission, meter, read } = setup();
  try {
    const job = with_mission_job(meter, signal => new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true })));
    repo.save("session", { ...mission, status: "stopped" });
    await expect(job).rejects.toThrow("stopped");
    expect(() => meter.reserve(0.1)).toThrow();
    expect(read().reserved_usd).toBe(0);
  } finally { db.close(); }
});

test("streamed collection settles once at finish and raw readiness cannot dispatch inside a mission", async () => {
  const { db, meter, read } = setup();
  let sent = 0;
  const model = new MockLanguageModelV4({ doStream: async () => {
    expect(read().reserved_usd).toBeGreaterThan(1);
    return { stream: convertArrayToReadableStream([
      { type: "text-start", id: "text" }, { type: "text-delta", id: "text", delta: "ok" }, { type: "text-end", id: "text" },
      { type: "finish", usage: { inputTokens: { total: 40, noCache: 30, cacheRead: 10, cacheWrite: 0 },
        outputTokens: { total: 20, text: 15, reasoning: 5 } }, finishReason: { unified: "stop", raw: "stop" } },
    ]) };
  } });
  try {
    const step = create_model_step([candidate], { openai: () => model });
    await with_mission_meter(meter, () => step({ messages: [{ role: "user", content: "fixture" }], tool_providers: {},
      signal: AbortSignal.timeout(1000), on_text: () => {}, on_attempt: () => {} }));
    expect(read().spent_usd).toBeCloseTo(0.020035, 8);
    expect(read().reserved_usd).toBe(0);
    await expect(with_mission_meter(meter, () => decide_presentation_readiness({} as TResearchBundle, 6, AbortSignal.timeout(1000),
      { key: "fixture", base_url: undefined }, async () => { sent++; return Response.json({}); }))).rejects.toThrow("verified mission price");
    expect(sent).toBe(0);
  } finally { db.close(); }
});

test("hosted search with unitemized content retains its allowance separately from measured spend", async () => {
  const { db, meter, read } = setup();
  const openai = createOpenAI({ apiKey: "fixture", fetch: async () => Response.json({
    id: "resp", model: "gpt-5.4-mini", created_at: 1, status: "completed",
    output: [{ type: "web_search_call", id: "ws", status: "completed", action: { type: "search", query: "fixture" } }],
    usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 0 }, output_tokens: 10 },
  }) });
  const provider = research_provider({ ...candidate, model: "gpt-5.4-mini" }, openai);
  try {
    await with_mission_meter(meter, () => provider.lookup("fixture", undefined, AbortSignal.timeout(1000)));
    expect(read().spent_usd).toBeCloseTo(0.0201, 8);
    expect(read().reserved_usd).toBeCloseTo(0.131072, 8);
  } finally { db.close(); }
});
