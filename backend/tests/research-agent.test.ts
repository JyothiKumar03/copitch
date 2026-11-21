import { expect, test } from "bun:test";
import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test";
import { create_model_step } from "../src/services/ai-sdk";
import { collect_research } from "../src/services/research-agent";
import type { TCollectResearch, TResearchAgentState } from "../src/types/research-agent";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 4, reasoning: 0, text: 4 },
};
const call = (...calls: [string, Record<string, unknown>][]) => ({
  stream: convertArrayToReadableStream([
    ...calls.map(([toolName, input], index) => ({
      type: "tool-call" as const, toolCallId: toolName + "-" + index, toolName, input: JSON.stringify(input),
    })),
    { type: "finish" as const, usage, finishReason: { unified: "tool-calls" as const, raw: "tool_calls" } },
  ]),
});
const answer = (delta: string) => ({
  stream: convertArrayToReadableStream([
    { type: "text-start" as const, id: "note" },
    { type: "text-delta" as const, id: "note", delta },
    { type: "text-end" as const, id: "note" },
    { type: "finish" as const, usage, finishReason: { unified: "stop" as const, raw: "stop" } },
  ]),
});
const assessment = (notes: string) => answer(JSON.stringify({ decision: "complete", notes }));
const request_pass = (target_id: string, tool = "read_url") => answer(JSON.stringify({
  decision: "continue", target_id, tool, notes: "The reporting date remains unsupported.",
  gap: "The reporting period for the participant count.", reason: "The unused source contains the dated report.",
}));
const fixture_model_step = (...steps: ReturnType<typeof call>[]) => {
  const model = new MockLanguageModelV4({ doStream: steps });
  const step = create_model_step([{ model: "fixture", provider: "openai", tool_providers: ["session"], max_output_tokens: 512 }],
    { openai: () => model });
  return { model, step };
};
const brief = {
  brief_id: "scope", summary: "Present the growth project", urls: ["https://company.example/"], source_policy: "public_search" as const,
  public_queries: ["Company growth project"], messages: [], materials: "", question: null,
  intent: { subject: "Company", audience: "Team", outcome: "Understand growth", deliverable: "Pitch" },
};
const test_input = (options: Partial<TCollectResearch>): TCollectResearch => ({
  brief, signal: new AbortController().signal, evidence: [], gaps: [], check_current: () => {},
  lookup: async () => { throw new Error("Unexpected lookup"); },
  model_step: async () => { throw new Error("Unexpected model step"); },
  ...options,
});

test("the model chooses two tools from the research goal, follows a result and returns notes", async () => {
  const { model, step } = fixture_model_step(
    call(["web_search", { query_id: "S1" }]),
    call(["read_url", { source_id: "S2" }]),
    assessment("P1 covers the project reach. The date remains unknown."),
  );
  const requested: string[] = [];
  const checkpoints: TResearchAgentState[] = [];
  const state = await collect_research(test_input({
    brief: { ...brief, urls: [] },
    model_step: step,
    checkpoint: snapshot => checkpoints.push(snapshot),
    lookup: async ({ kind, target, known_links }) => {
      expect(checkpoints.at(-1)?.lookup_attempts).toBe(requested.length + 1);
      requested.push(target);
      if (kind === "search") return {
        links: [{ url: "https://company.example/growth", title: "Growth project" }],
        hits: [{ url: "https://company.example/growth", title: "Untrusted generated search excerpt", passage: "The project had a billion participants." }],
      };
      expect(known_links).toContain("https://company.example/growth");
      return { url: "https://www.company.example/growth", hits: [
        { url: "https://www.company.example/growth", title: "Growth project", passage: "The project had 30,000 participants." },
      ] };
    },
  }));
  expect(requested).toEqual([brief.public_queries[0], "https://company.example/growth"]);
  expect(model.doStreamCalls[0].tools?.map(tool => tool.name).sort()).toEqual(["read_url", "web_search"]);
  expect(model.doStreamCalls[0].providerOptions?.openai).toEqual({ parallelToolCalls: false, store: false });
  expect(JSON.stringify(model.doStreamCalls[1].prompt)).toContain("https://company.example/growth");
  expect(JSON.stringify(model.doStreamCalls[2].prompt)).toContain("https://www.company.example/growth");
  expect(state.evidence).toMatchObject([{ id: "P1", passage: "The project had 30,000 participants." }]);
  expect(state.lookup_attempts).toBe(2);
  expect(state.read_pages).toBe(1);
  expect(state.research_notes).toBe("P1 covers the project reach. The date remains unknown.");
  expect(state.stop_reason).toBe("finished");
});

test("the model cannot finish an approved public brief with zero lookups and an unread explicit source", async () => {
  const { model, step } = fixture_model_step(
    assessment("The source has enough information."),
    call(["read_url", { source_id: "S1" }]),
    assessment("Cite the opening date from P1."),
  );
  const state = await collect_research(test_input({ model_step: step, lookup: async ({ target }) => ({
    url: target, hits: [{ url: target, title: "Company", passage: "The project opened in 2025." }],
  }) }));
  expect(JSON.stringify(model.doStreamCalls[1].prompt)).toContain("Attempt the outstanding host-approved reads before finishing: S1.");
  expect(state.read_pages).toBe(1);
  expect(state.stop_reason).toBe("finished");
});

test("each pass permits ten lookup attempts, including errors, and a third pass is refused", async () => {
  const urls = Array.from({ length: 21 }, (_, index) => "https://company.example/" + (index + 1));
  const batch = (offset: number) => Array.from({ length: 10 }, (_, index) =>
    call(["read_url", { source_id: "S" + (offset + index + 1) }], ["read_url", { source_id: "S21" }]));
  const { model, step } = fixture_model_step(...batch(0), request_pass("S11"), ...batch(10), request_pass("S21"));
  const dispatched: string[] = [];
  const state = await collect_research(test_input({
    brief: { ...brief, urls, public_queries: [] },
    model_step: step,
    lookup: async ({ target }) => { dispatched.push(target); throw new Error("Lookup did not respond"); },
  }));
  expect(dispatched).toEqual(urls.slice(0, 20));
  expect(model.doStreamCalls).toHaveLength(22);
  expect(model.doStreamCalls[10].tools ?? []).toHaveLength(0);
  expect(model.doStreamCalls[21].tools ?? []).toHaveLength(0);
  expect(state.completed_lookups).toBe(20);
  expect(state.lookup_attempts).toBe(20);
  expect(state.read_pages).toBe(0);
  expect(state.pass).toBe(2);
  expect(state.stop_reason).toBe("budget");
});

test("worker interruption preserves a successful read and its eligible links for restart", async () => {
  let previous: TResearchAgentState | undefined;
  const checkpoint = (state: TResearchAgentState) => { previous = state; };
  const initial = fixture_model_step(call(["read_url", { source_id: "S1" }]));
  const seen: string[] = [];
  const lookup: TCollectResearch["lookup"] = async ({ target }) => {
    seen.push(target);
    return target === brief.urls[0] ? {
      hits: [{ url: target, title: "Home", passage: "A project page gives the counts." }],
      links: [{ url: "https://company.example/metrics", title: "Project metrics" }],
    } : { hits: [{ url: target, title: "Project metrics", passage: "The project had 30,000 participants." }] };
  };
  await expect(collect_research(test_input({
    lookup, checkpoint,
    model_step: async request => {
      await initial.step(request);
      throw new Error("Worker stopped");
    },
  }))).rejects.toThrow("Worker stopped");
  expect(previous?.evidence[0].id).toBe("P1");

  const resumed = fixture_model_step(call(["read_url", { source_id: "S3" }]), assessment("Cite P2 for reach."));
  const state = await collect_research(test_input({ lookup, previous, checkpoint, model_step: resumed.step }));
  expect(seen).toEqual([brief.urls[0], "https://company.example/metrics"]);
  expect(state.lookup_attempts).toBe(2);
  expect(state.model_attempts).toHaveLength(3);
  expect(state.evidence.map(item => item.id)).toEqual(["P1", "P2"]);
});

test("a model continuation survives restart and resumes with its outstanding gap", async () => {
  let previous: TResearchAgentState | undefined;
  const first = fixture_model_step(call(["read_url", { source_id: "S1" }]), request_pass("S3"));
  const read: string[] = [];
  const lookup: TCollectResearch["lookup"] = async ({ target }) => {
    read.push(target);
    return target === brief.urls[0] ? {
      hits: [{ url: target, title: "Home", passage: "The project had 30,000 participants." }],
      links: [{ url: "https://company.example/dated-report", title: "Dated report" }],
    } : { hits: [{ url: target, title: "Dated report", passage: "The project counted participants during 2025." }] };
  };
  await expect(collect_research(test_input({
    lookup, model_step: first.step,
    checkpoint: snapshot => {
      previous = snapshot;
      if (snapshot.pass === 2) throw new Error("Worker stopped after saving continuation");
    },
  }))).rejects.toThrow("Worker stopped");
  expect(previous?.pass).toBe(2);
  expect(previous?.pass_steps).toBe(0);
  expect(previous?.continuation?.target_id).toBe("S3");
  const second = fixture_model_step(call(["read_url", { source_id: "S3" }]), assessment("P1 supports the count. P2 supports 2025."));
  const state = await collect_research(test_input({ previous, lookup, model_step: second.step }));
  expect(JSON.stringify(second.model.doStreamCalls[0].prompt)).toContain("The unused source contains the dated report.");
  expect(read).toEqual([brief.urls[0], "https://company.example/dated-report"]);
  expect(state.research_notes).toBe("P1 supports the count. P2 supports 2025.");
  expect(state.stop_reason).toBe("finished");
});

test.each([
  ["an unapproved target", request_pass("S999")],
  ["an already used target", request_pass("S1")],
  ["the wrong tool for an approved target", request_pass("S2")],
  ["malformed assessment", answer("Continue with S2")],
])("%s cannot start a second pass", async (_name, terminal) => {
  const { model, step } = fixture_model_step(call(["read_url", { source_id: "S1" }]), terminal);
  const state = await collect_research(test_input({
    model_step: step, lookup: async () => ({ hits: [] }),
  }));
  expect(model.doStreamCalls).toHaveLength(2);
  expect(state.pass).toBe(1);
  expect(state.stop_reason).toBe("finished");
});

test("a v2 checkpoint restores remaining lookup capacity and retained evidence", async () => {
  const evidence = [{ id: "P1", location: "Home", origin: "public" as const, passage: "A participant count was recorded." }];
  const previous: TCollectResearch["previous"] = {
    version: 2, brief_id: brief.brief_id, started_at: Date.now(), steps: 9, lookup_attempts: 9,
    completed_lookups: 9, model_attempts: [], evidence, gaps: [], research_notes: "Discard obsolete note",
    messages: [{ role: "assistant", content: "Discard obsolete tool history" }],
    targets: [
      { id: "S1", kind: "read", value: brief.urls[0], label: "Home", seed: true, status: "read", evidence_ids: ["P1"] },
      { id: "S2", kind: "search", value: brief.public_queries[0], label: "Query" },
    ],
  };
  const { model, step } = fixture_model_step(call(["web_search", { query_id: "S2" }]), assessment("Cite P1."));
  const state = await collect_research(test_input({
    evidence, previous, model_step: step, lookup: async ({ target }) => {
      expect(target).toBe(brief.public_queries[0]);
      return { hits: [] };
    },
  }));
  expect(model.doStreamCalls[1].tools ?? []).toHaveLength(0);
  expect(JSON.stringify(model.doStreamCalls[0].prompt)).not.toContain("Discard obsolete");
  expect(state.lookup_attempts).toBe(10);
  expect(state.evidence).toEqual(evidence);
  expect(state.version).toBe(3);
  expect(state.pass).toBe(1);
});

test("files-only research keeps selected material without a network or discovery model call", async () => {
  const selected = [{ id: "F1", location: "Report page 5", origin: "material" as const, passage: "42 completed pilots." }];
  const state = await collect_research(test_input({
    brief: { ...brief, source_policy: "files_only" }, evidence: selected,
  }));
  expect(state.steps).toBe(0);
  expect(state.read_pages).toBe(0);
  expect(state.stop_reason).toBe("finished");
  expect(state.evidence).toEqual(selected);
});
