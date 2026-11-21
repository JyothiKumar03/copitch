import { expect, test } from "bun:test";
import { SessionStore } from "../src/repositories/session";
import { read_host_page, site_url } from "../src/services/host-pages";
import { build_research } from "../src/services/research";
import { ResearchWorker } from "../src/workers/research";
import type { TModelStep } from "../src/types/ai";
import type { TResearchBrief, TResearchProvider } from "../src/types/research";

const brief = (): TResearchBrief => ({
  studio_version: 2, brief_id: crypto.randomUUID(), question: null, summary: "Introduce a pilot.",
  source_policy: "public_search", public_queries: ["pilot outcomes", "pilot enrollment"],
  urls: [], materials: "", messages: ["What should I say to the team?"],
});

const provider = (search: TResearchProvider["lookup"]): TResearchProvider => ({
  collect_step: async ({ tool_providers, messages, signal }) => {
    await tool_providers.session?.web_search?.execute?.({ query_id: "S1" }, { messages, toolCallId: "search-first", abortSignal: signal });
    return { messages: [], continue_with_tools: false };
  },
  lookup: search,
  clarify: async () => { throw new Error("The brief is approved."); },
  draft: async () => {
    const support = [{ evidence_id: "M1", excerpt: "Twelve teams enrolled." }];
    return {
      title: "A pilot with twelve teams",
      sections: [{ heading: "Pilot participation", paragraphs: [{ prose: "Twelve teams enrolled.", support }] }],
      pitch_script: [
        { purpose: "opening", prose: "I'd like to walk you through our pilot.", support },
        { purpose: "point", prose: "Twelve teams enrolled.", support },
        { purpose: "close", prose: "Let's discuss what we learned from those teams.", support },
      ],
      gaps: [],
    };
  },
  verify: async review => review.units.map(({ id }) => ({ id, decision: "supported" })),
});

test("an approved search can discover pages but its generated summaries cannot become a pitch", async () => {
  const db = new SessionStore(":memory:");
  const scope = brief();
  db.replace_brief("host", undefined, scope);
  const job = db.research_jobs.enqueue("host", scope.brief_id);
  const requests: string[] = [];
  const worker = new ResearchWorker(() => db, () => provider(async (query, url) => {
    requests.push(query);
    expect(url).toBeUndefined();
    return [{ passage: "Twelve teams enrolled.", title: "Pilot summary", url: "https://example.org/pilot" }];
  }));
  await worker.tick(job.job_id);
  expect(requests).toEqual(["pilot outcomes"]);
  expect(db.research_jobs.get("host", job.job_id)?.status).toBe("needs_input");
  expect(db.research_by_brief("host", scope.brief_id)).toBeUndefined();
});

test("framing alone ends in needs input without a pitch or retry", async () => {
  const db = new SessionStore(":memory:");
  const scope: TResearchBrief = { ...brief(), source_policy: "files_only", public_queries: [] };
  db.replace_brief("host", undefined, scope);
  const job = db.research_jobs.enqueue("host", scope.brief_id);
  const worker = new ResearchWorker(() => db, () => provider(async () => { throw new Error("Files only."); }));
  await worker.tick(job.job_id);
  const outcome = db.research_jobs.get("host", job.job_id);
  expect(outcome?.status).toBe("needs_input");
  expect(outcome?.error).toContain("Share a working link");
  expect(outcome?.result).toBeUndefined();
  expect(db.research_by_brief("host", scope.brief_id)).toBeUndefined();
  expect(db.research_jobs.enqueue("host", scope.brief_id, true).status).toBe("needs_input");
});

test("the studio worker binds source IDs and publishes a verified files-only context", async () => {
  const db = new SessionStore(":memory:");
  const scope: TResearchBrief = { ...brief(), source_policy: "files_only", materials: "Twelve teams enrolled.",
    urls: ["https://example.org/"], intent: { subject: "Pilot rollout", audience: "Operations",
      outcome: "Share what the pilot did", deliverable: "Team introduction" } };
  db.replace_brief("host", undefined, scope);
  const job = db.research_jobs.enqueue("host", scope.brief_id);
  let lookups = 0;
  let model_steps = 0;
  const configured = provider(async () => { lookups++; return []; });
  const run_step: TModelStep = async () => { model_steps++; throw new Error("Files-only has no lookup tools."); };
  configured.collect_step = run_step;
  const write = configured.draft;
  configured.draft = async (request, evidence, gaps, signal, reference_mode) => {
    expect(JSON.parse(request).intent).toEqual(scope.intent);
    expect(reference_mode).toBe("context");
    const original = await write(request, evidence, gaps, signal);
    const support = [{ evidence_id: "M1", excerpt: "" }];
    return { ...original, sections: original.sections.map(section => ({ ...section,
      paragraphs: section.paragraphs.map(paragraph => ({ ...paragraph, support })) })),
      pitch_script: original.pitch_script?.map(passage => ({ ...passage, support })) };
  };
  await new ResearchWorker(() => db, () => configured).tick(job.job_id);
  expect(model_steps).toBe(0);
  expect(lookups).toBe(0);
  expect(db.research_jobs.get("host", job.job_id)?.status).toBe("completed");
  const saved = db.research_by_brief("host", scope.brief_id);
  expect(saved?.context_markdown).toContain("Twelve teams enrolled.");
  expect(saved?.context_markdown).not.toContain("## Talk track");
  expect(saved?.context_markdown).toContain("[^M1]: Supplied material");
  expect(saved?.pitch_script).toBeUndefined();
});

test("approved research uses verbatim host voice statements when extracted notes omit the measurable result", async () => {
  const note = "I lead onboarding.";
  const measured = "We recorded 24 completed setups in week three. We do not know whether the guide caused that result.";
  const scope: TResearchBrief = { ...brief(), source_policy: "files_only", public_queries: [], studio_notes: [note],
    history: [
      { role: "host", text: note, voice_items: ["live:1"] },
      { role: "host", text: measured, voice_items: ["live:2"] },
      { role: "host", text: measured, voice_items: ["live:3"] },
      { role: "assistant", text: "The guide caused the increase.", voice_items: ["live:4"] },
      { role: "host", text: "Go ahead.", intent: "approval", voice_items: ["live:5"] },
      { role: "host", text: "Prepare the report." },
    ] };
  const db = new SessionStore(":memory:");
  db.replace_brief("host", undefined, scope);
  const job = db.research_jobs.enqueue("host", scope.brief_id);
  const configured = provider(async () => { throw new Error("Files only"); });
  configured.draft = async (_brief, evidence) => {
    expect(evidence.map(row => [row.id, row.origin, row.passage])).toEqual([["H1", "host", note], ["H2", "host", measured]]);
    return { title: "Onboarding result", gaps: [], sections: [{ heading: "Week three", paragraphs: [
      { prose: measured, support: [{ evidence_id: "H2", excerpt: "" }] },
    ] }] };
  };
  let reviewed = false;
  configured.verify = async review => {
    reviewed = true;
    expect(review.evidence.map(row => row.passage)).toEqual([measured]);
    return review.units.map(({ id }) => ({ id, decision: "supported" }));
  };
  await new ResearchWorker(() => db, () => configured).tick(job.job_id);
  const saved = db.research_by_brief("host", scope.brief_id);
  expect(reviewed).toBe(true);
  expect(db.research_jobs.get("host", job.job_id)?.status).toBe("completed");
  expect(saved?.context_markdown).toContain(measured);
  expect(saved?.context_markdown).not.toContain("[^H2]");
  expect(saved?.findings.sections[0].paragraphs[0].support[0]).toEqual({ evidence_id: "H2", excerpt: measured });
});

test("a replacement lease keeps an empty approved search and does not publish a public brief from private notes alone", async () => {
  const db = new SessionStore(":memory:");
  const scope = { ...brief(), materials: "Twelve teams enrolled.", public_queries: ["pilot enrollment"] };
  db.replace_brief("host", undefined, scope);
  const jobs = db.research_jobs;
  const job = jobs.enqueue("host", scope.brief_id);
  const first = jobs.claim(job.job_id)!;
  const calls: string[] = [];
  const configured = provider(async query => { calls.push(query); return []; });
  const run = (lease: typeof first) => build_research(scope, configured, AbortSignal.timeout(2_000), () => jobs.assert_owner(lease),
    lease.checkpoint, checkpoint => jobs.checkpoint(lease, checkpoint));
  configured.collect_step = async ({ messages, tool_providers, signal, on_text }) => {
    if (!calls.length) {
      await tool_providers.session!.web_search.execute!({ query_id: "S1" }, { messages, toolCallId: "search", abortSignal: signal });
      throw new Error("Worker stopped after search");
    }
    expect(tool_providers.session).toBeUndefined();
    on_text(JSON.stringify({ decision: "complete", notes: "No candidate URLs were found." }));
    return { messages: [], continue_with_tools: false };
  };
  configured.draft = async () => { throw new Error("No public evidence was collected."); };
  await expect(run(first)).rejects.toThrow("Worker stopped after search");
  const replacement = jobs.claim(job.job_id, Date.now() + 16_000)!;
  expect(replacement.checkpoint).toMatchObject({ completed_lookups: 1, collection: { version: 3 } });
  await expect(run(replacement)).rejects.toThrow("couldn't read any public evidence");
  expect(calls).toEqual(["pilot enrollment"]);
  expect(db.research_by_brief("host", scope.brief_id)).toBeUndefined();
});

test("a verified context is available without a saved script", async () => {
  const db = new SessionStore(":memory:");
  const scope: TResearchBrief = { ...brief(), source_policy: "files_only", public_queries: [], materials: "Twelve teams enrolled." };
  db.replace_brief("host", undefined, scope);
  const job = db.research_jobs.enqueue("host", scope.brief_id);
  const configured = provider(async () => [
    { passage: "Twelve teams enrolled.", title: "Pilot summary", url: "https://example.org/pilot" },
  ]);
  const draft = configured.draft;
  configured.draft = async (...input) => ({ ...await draft(...input), pitch_script: [] });
  const worker = new ResearchWorker(() => db, () => configured);
  await worker.tick(job.job_id);
  expect(db.research_jobs.get("host", job.job_id)?.status).toBe("completed");
  expect(db.research_by_brief("host", scope.brief_id)?.context_markdown).toContain("Twelve teams enrolled.");
});

test("the context worker saves only canonical source-checked graphs with the research prose", async () => {
  const db = new SessionStore(":memory:");
  const january = "Revenue in January 2025: USD 1,200.";
  const february = "Revenue in February 2025: USD 1,500.";
  const scope: TResearchBrief = { ...brief(), source_policy: "files_only", materials: january + "\n" + february };
  db.replace_brief("host", undefined, scope);
  const job = db.research_jobs.enqueue("host", scope.brief_id);
  const configured = provider(async () => { throw new Error("Files only"); });
  const graph = { name: "Revenue", description: "Monthly reported revenue in USD.", type: "line", data: [
    { label: "January 2025", value: 1200, unit: "USD", period: "January 2025", evidence_id: "M1", excerpt: january },
    { label: "February 2025", value: 1500, unit: "USD", period: "February 2025", evidence_id: "M1", excerpt: february },
  ] };
  configured.draft = async () => ({
    title: "Revenue", gaps: [], sections: [{ heading: "Monthly figures", paragraphs: [{ prose: "Reported revenue rose in February.",
      support: [{ evidence_id: "M1", excerpt: "" }] }] }],
    graph_xml: "Unchecked preamble\n<graph>" + JSON.stringify(graph) + "</graph>\n<graph>" +
      JSON.stringify({ ...graph, name: "Unsupported figures", data: [{ ...graph.data[0], value: 999 }, graph.data[1]] }) + "</graph>",
  });
  let graph_checks = 0;
  configured.verify = async review => {
    if (review.units[0]?.id.startsWith("graph-")) graph_checks++;
    return review.units.map(unit => ({ id: unit.id, decision: "supported" }));
  };
  await new ResearchWorker(() => db, () => configured).tick(job.job_id);
  const result = db.research_by_brief("host", scope.brief_id)?.context_markdown;
  expect(graph_checks).toBe(1);
  expect(result).toContain('<graph>{"name":"Revenue"');
  expect(result).toContain("Graph sources [^M1]");
  expect(result?.match(/\[\^M1\]:/gu)).toHaveLength(1);
  expect(result).not.toContain('"excerpt"');
  expect(result).not.toContain("Unchecked preamble");
  expect(result).not.toContain("Unsupported figures");
});

test("a model-requested coverage revision keeps verified context if the revision fails", async () => {
  const db = new SessionStore(":memory:");
  const scope: TResearchBrief = { ...brief(), source_policy: "files_only", materials: "Twelve teams enrolled. Nine completed the pilot.",
    intent: { subject: "Pilot", audience: "Team", outcome: "Understand participation", deliverable: "Research context" } };
  db.replace_brief("host", undefined, scope);
  const job = db.research_jobs.enqueue("host", scope.brief_id);
  const configured = provider(async () => { throw new Error("Files-only research cannot look up public sources."); });
  const write = configured.draft;
  const prompts: string[] = [];
  configured.draft = async (...args) => {
    prompts.push(args[0]);
    if (prompts.length > 1) throw new Error("Revision failed");
    return write(...args);
  };
  configured.verify = async review => ({ verdicts: review.units.map(unit => ({ id: unit.id, decision: "supported" })),
    omissions: [{ finding: "Nine teams completed the pilot", reason: "The brief asks for participation outcomes", evidence_ids: ["M1"] }] });
  await new ResearchWorker(() => db, () => configured).tick(job.job_id);
  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain("Nine teams completed the pilot");
  expect(db.research_jobs.get("host", job.job_id)?.status).toBe("completed");
  expect(db.research_by_brief("host", scope.brief_id)?.context_markdown).toContain("Twelve teams enrolled.");
});

test("a studio draft cannot publish when independent verification returns no decisions", async () => {
  const db = new SessionStore(":memory:");
  const scope = { ...brief(), materials: "Twelve teams enrolled." };
  db.replace_brief("host", undefined, scope);
  const job = db.research_jobs.enqueue("host", scope.brief_id);
  const configured = provider(async () => [
    { passage: "Twelve teams enrolled.", title: "Pilot summary", url: "https://example.org/pilot" },
  ]);
  configured.verify = async () => [];
  await new ResearchWorker(() => db, () => configured).tick(job.job_id);
  expect(db.research_jobs.get("host", job.job_id)?.status).toBe("needs_input");
  expect(db.research_by_brief("host", scope.brief_id)).toBeUndefined();
});

test("a rejected private draft gets one narrower redraft without a public search", async () => {
  const db = new SessionStore(":memory:");
  const scope: TResearchBrief = { ...brief(), source_policy: "files_only", public_queries: [], materials: "Twelve teams enrolled." };
  db.replace_brief("host", undefined, scope);
  const job = db.research_jobs.enqueue("host", scope.brief_id);
  let searches = 0;
  let checks = 0;
  const prompts: string[] = [];
  const configured = provider(async () => {
    searches++;
    return [{ passage: "Twelve teams enrolled.", title: "Pilot summary", url: "https://example.org/pilot" }];
  });
  const draft = configured.draft;
  configured.draft = async (...input) => {
    prompts.push(input[0]);
    return draft(...input);
  };
  configured.verify = async ({ units }) => {
    const decision = ++checks === 1 ? "unsupported" : "supported";
    return units.map(({ id }) => ({ id, decision }));
  };
  await new ResearchWorker(() => db, () => configured).tick(job.job_id);
  expect(searches).toBe(0);
  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain("The first draft did not pass verification");
  expect(db.research_jobs.get("host", job.job_id)?.status).toBe("completed");
});

test("direct page reading refuses private address literals", async () => {
  await expect(read_host_page("http://127.0.0.1/", AbortSignal.timeout(1000))).rejects.toThrow("public HTTP or HTTPS");
});

test("a site address written any way becomes one public https address", () => {
  expect(["jk-ai.in", "http://jk-ai.in", "JK-AI.in/", " https://jk-ai.in#top "].map(site_url)).toEqual(Array(4).fill("https://jk-ai.in/"));
  expect(site_url("https://www.jk-ai.in/resume")).toBe("https://www.jk-ai.in/resume");
  expect([site_url("localhost"), site_url("http://127.0.0.1"), site_url("not a url")]).toEqual([undefined, undefined, undefined]);
});
