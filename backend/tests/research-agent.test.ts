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
const plan = (...questions: [string, "number" | "fact"][]) =>
  ["plan_coverage", { items: questions.map(([question, needs]) => ({ question, needs })) }] as [string, Record<string, unknown>];
const done = (note = "P1 states the participant count.") => answer(note);
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


const participants = "How many participants did the growth project have?";
const opened = "When did the growth project open, by year?";

test("the agent plans a checklist, searches and reads in parallel, and records quoted answers", async () => {
  const { model, step } = fixture_model_step(
    call(plan([participants, "number"], [opened, "number"])),
    call(["web_search", { searches: [
      { item_id: "C1", query: "growth project participants 2025" },
      { item_id: "C2", query: "growth project opening year" },
    ] }]),
    call(["read_url", { source_ids: ["S3", "S4"], item_id: "C1" }]),
    call(["record_answers", { answers: [
      { item_id: "C1", evidence_id: "P1", excerpt: "had 30,000 participants", answer: "30,000 participants" },
      { item_id: "C2", evidence_id: "P2", excerpt: "opened in 2025", answer: "2025" },
    ] }]),
    done(),
  );
  const dispatched: string[] = [];
  const state = await collect_research(test_input({
    brief: { ...brief, urls: [] }, model_step: step,
    lookup: async ({ kind, target }) => {
      dispatched.push(kind + ":" + target);
      if (kind === "search") return { hits: [], links: [{ url: "https://company.example/" + (target.includes("opening") ? "history" : "growth"), title: target }] };
      return { url: target, hits: [{ url: target, title: "Page", passage: target.endsWith("growth")
        ? "The project had 30,000 participants." : "The project opened in 2025 in Pune." }] };
    },
  }));
  expect(dispatched.slice(0, 2).sort()).toEqual(["search:growth project opening year", "search:growth project participants 2025"]);
  expect(dispatched.slice(2).sort()).toEqual(["read:https://company.example/growth", "read:https://company.example/history"]);
  expect(model.doStreamCalls[0].providerOptions?.openai).toEqual({ parallelToolCalls: true, store: false });
  expect(state.checklist.map(item => [item.id, item.status, item.answer])).toEqual([["C1", "covered", "30,000 participants"], ["C2", "covered", "2025"]]);
  expect(state.lookup_attempts).toBe(4);
  expect(state.read_pages).toBe(2);
  expect(state.pass).toBe(1);
  expect(state.stop_reason).toBe("finished");
});

test("search is refused before the checklist exists, and stopping without one is sent back", async () => {
  const { model, step } = fixture_model_step(
    call(["web_search", { searches: [{ item_id: "C1", query: "growth project" }] }]),
    done("Nothing to do."),
    call(plan([participants, "number"])),
    call(["web_search", { searches: [{ item_id: "C1", query: "growth project participants" }] }]),
    call(["read_url", { source_ids: ["S2"] }]),
    call(["record_answers", { answers: [{ item_id: "C1", evidence_id: "P1", excerpt: "30,000 participants", answer: "30,000" }] }]),
    done(),
  );
  const state = await collect_research(test_input({ brief: { ...brief, urls: [] }, model_step: step, lookup: async ({ kind, target }) => kind === "search"
    ? { hits: [], links: [{ url: "https://company.example/growth", title: "Growth" }] }
    : { hits: [{ url: target, title: "Growth", passage: "The project had 30,000 participants." }] } }));
  expect(JSON.stringify(model.doStreamCalls[1].prompt)).toContain("Call plan_coverage before searching.");
  expect(JSON.stringify(model.doStreamCalls[2].prompt)).toContain("Call plan_coverage first");
  expect(state.lookup_attempts).toBe(2);
  expect(state.stop_reason).toBe("finished");
});

test("answers need a verbatim excerpt, and number items need the number", async () => {
  const { step } = fixture_model_step(
    call(plan([participants, "number"], ["Who runs the project?", "fact"])),
    call(["read_url", { source_ids: ["S1"] }]),
    call(["record_answers", { answers: [
      { item_id: "C1", evidence_id: "P1", excerpt: "a billion participants", answer: "1 billion" },
      { item_id: "C1", evidence_id: "P1", excerpt: "The project had", answer: "many" },
      { item_id: "C2", evidence_id: "P1", excerpt: "run by  the  Growth Office", answer: "The Growth Office" },
    ] }]),
    done(), done(), done(), done(),
  );
  const checkpoints: string[] = [];
  const state = await collect_research(test_input({
    brief: { ...brief, public_queries: [] }, model_step: step,
    checkpoint: snapshot => checkpoints.push(JSON.stringify(snapshot.checklist)),
    lookup: async ({ target }) => ({ hits: [{ url: target, title: "Home", passage: "The project had 30,000 participants, run by the Growth Office." }] }),
  }));
  expect(state.checklist.map(item => item.status)).toEqual(["open", "covered"]);
  expect(state.gaps).toContain("Not found within the research budget: " + participants);
  expect(state.stop_reason).toBe("budget");
});

test("an open item is sent back for a rewritten query and can be marked unavailable only after two tries", async () => {
  const { model, step } = fixture_model_step(
    call(plan([participants, "number"])),
    call(["web_search", { searches: [{ item_id: "C1", query: "growth project data portal" }] }]),
    call(["mark_unavailable", { item_id: "C1", reason: "Only a data portal was found." }]),
    done("Could not find it."),
    call(["web_search", { searches: [
      { item_id: "C1", query: "growth project data portal" },
      { item_id: "C1", query: "growth project participants annual report 2025" },
    ] }]),
    call(["mark_unavailable", { item_id: "C1", reason: "Two searches found only catalog pages." }]),
    done("The participant count is not published."),
  );
  const searched: string[] = [];
  const state = await collect_research(test_input({
    brief: { ...brief, urls: [] }, model_step: step,
    lookup: async ({ target }) => { searched.push(target); return { hits: [] }; },
  }));
  expect(JSON.stringify(model.doStreamCalls[3].prompt)).toContain("Try at least two differently worded searches");
  expect(JSON.stringify(model.doStreamCalls[4].prompt)).toContain("These checklist items are still open: C1");
  expect(JSON.stringify(model.doStreamCalls[5].prompt)).toContain("This query already ran. Rewrite it");
  expect(searched).toEqual(["growth project data portal", "growth project participants annual report 2025"]);
  expect(state.checklist[0]).toMatchObject({ status: "unavailable", lookups: 2 });
  expect(state.gaps[0]).toContain("Not established: " + participants);
  expect(state.stop_reason).toBe("finished");
});

test("a host's own site is read in focused mode: no web search and a 12-lookup cap, including failures", async () => {
  const urls = Array.from({ length: 40 }, (_, index) => "https://company.example/" + (index + 1));
  const reads = (offset: number) => call(
    ["read_url", { source_ids: urls.slice(offset, offset + 4).map((_, index) => "S" + (offset + index + 1)) }],
    ["read_url", { source_ids: urls.slice(offset + 4, offset + 8).map((_, index) => "S" + (offset + index + 5)) }],
    ["read_url", { source_ids: ["S" + (offset + 9)] }],
  );
  const { model, step } = fixture_model_step(
    call(plan([participants, "number"])), ...Array.from({ length: 5 }, (_, index) => reads(index * 8)), done(), done(), done(), done(),
  );
  const dispatched: string[] = [];
  const state = await collect_research(test_input({
    brief: { ...brief, urls, public_queries: [] }, model_step: step,
    lookup: async ({ target }) => { dispatched.push(target); throw new Error("Lookup did not respond"); },
  }));
  expect(dispatched).toHaveLength(12);
  expect(state.lookup_attempts).toBe(12);
  expect(new Set(dispatched).size).toBe(12);
  expect((model.doStreamCalls[0].tools ?? []).map(tool => tool.name)).not.toContain("web_search");
  expect(state.stop_reason).toBe("budget");
});

test("worker interruption keeps the checklist and evidence for restart", async () => {
  let previous: TResearchAgentState | undefined;
  const initial = fixture_model_step(call(plan([participants, "number"]), ["read_url", { source_ids: ["S1"] }]));
  const lookup: TCollectResearch["lookup"] = async ({ target }) => ({ hits: [{ url: target, title: "Home", passage: "The project had 30,000 participants." }] });
  await expect(collect_research(test_input({
    lookup, checkpoint: state => { previous = state; },
    model_step: async request => { await initial.step(request); throw new Error("Worker stopped"); },
  }))).rejects.toThrow("Worker stopped");
  expect(previous?.checklist).toHaveLength(1);
  expect(previous?.evidence[0].id).toBe("P1");
  const resumed = fixture_model_step(
    call(["record_answers", { answers: [{ item_id: "C1", evidence_id: "P1", excerpt: "30,000 participants", answer: "30,000" }] }]), done(),
  );
  const state = await collect_research(test_input({ lookup, previous, model_step: resumed.step }));
  expect(state.lookup_attempts).toBe(1);
  expect(state.checklist[0].status).toBe("covered");
  expect(state.stop_reason).toBe("finished");
});

test("a v3 checkpoint keeps its evidence and lookup count and starts a checklist", async () => {
  const evidence = [{ id: "P1", location: "Home", origin: "public" as const, url: brief.urls[0], passage: "The project had 30,000 participants." }];
  const previous: TCollectResearch["previous"] = {
    version: 3, brief_id: brief.brief_id, started_at: Date.now(), steps: 4, pass: 1, lookup_attempts: 4,
    completed_lookups: 4, model_attempts: [], evidence, gaps: [], messages: [{ role: "assistant", content: "Discard obsolete tool history" }],
    targets: [{ id: "S1", kind: "read", value: brief.urls[0], label: "Home", seed: true, status: "read", evidence_ids: ["P1"] }],
  };
  const { model, step } = fixture_model_step(
    call(plan([participants, "number"]), ["record_answers", { answers: [{ item_id: "C1", evidence_id: "P1", excerpt: "30,000 participants", answer: "30,000" }] }]),
    done(),
  );
  const state = await collect_research(test_input({ evidence, previous, model_step: step }));
  expect(JSON.stringify(model.doStreamCalls[0].prompt)).not.toContain("Discard obsolete");
  expect(state.version).toBe(4);
  expect(state.lookup_attempts).toBe(4);
  expect(state.checklist[0].status).toBe("covered");
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

test("a long report keeps the passages that answer the question, not its front matter", async () => {
  const front = Array.from({ length: 40 }, (_, index) => ({ url: brief.urls[0], title: "Report, page " + (index + 1), passage: "Foreword and acknowledgements section " + index }));
  const answer_page = { url: brief.urls[0], title: "Report, page 212", passage: "Participants in the growth project reached 30,000 in 2025." };
  const { step } = fixture_model_step(
    call(plan([participants, "number"])),
    call(["read_url", { source_ids: ["S1"] }]),
    call(["record_answers", { answers: [{ item_id: "C1", evidence_id: "P1", excerpt: "reached 30,000 in 2025", answer: "30,000" }] }]),
    done(),
  );
  const state = await collect_research(test_input({ model_step: step, lookup: async () => ({ hits: [...front, answer_page] }) }));
  expect(state.evidence[0]).toMatchObject({ id: "P1", location: "Report, page 212" });
  expect(state.evidence).toHaveLength(20);
  expect(state.checklist[0].status).toBe("covered");
});

test("host files with no links are used as supplied, and no link or file means a broad web hunt", async () => {
  const selected = [{ id: "M1", location: "Supplied material", origin: "material" as const, passage: "42 completed pilots." }];
  const focused = await collect_research(test_input({ brief: { ...brief, urls: [] }, evidence: selected }));
  expect(focused.steps).toBe(0);
  expect(focused.stop_reason).toBe("finished");
  const { model, step } = fixture_model_step(call(plan([participants, "number"])), done(), done(), done(), done());
  await collect_research(test_input({ brief: { ...brief, urls: [] }, model_step: step }));
  expect((model.doStreamCalls[0].tools ?? []).map(tool => tool.name).sort()).toEqual(["mark_unavailable", "plan_coverage", "read_url", "record_answers", "web_search"]);
});
