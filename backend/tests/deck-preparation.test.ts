import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { tmpdir } from "node:os";
import { create_api } from "../src/app";
import { create_deck_handler } from "../src/controllers/deck";
import { api_error } from "../src/middleware/api-error";
import { pitch_variant_key } from "../src/repositories/deck";
import { SessionStore } from "../src/repositories/session";
import { database } from "../src/repositories/store";
import { accounts } from "../src/routes/accounts";
import { create_deck_router } from "../src/routes/deck";
import type { TDeck } from "../src/types/deck";
import type { TResearchBrief, TResearchBundle } from "../src/types/research";
import { DeckPreparationWorker } from "../src/workers/deck-preparation";
import { AppError } from "../src/errors/app-error";
import { decide_presentation_readiness } from "../src/services/presentation-readiness";
import { serve_api } from "./helpers/serve-api";

const research = (): TResearchBundle => {
  const brief: TResearchBrief = { brief_id: crypto.randomUUID(), summary: "Present the pilot", messages: [], materials: "",
    source_policy: "files_only", urls: [], public_queries: [], question: null };
  return { research_id: crypto.randomUUID(), brief_id: brief.brief_id, confirmed_brief: brief, gaps: [],
    findings: { title: "Pilot", sections: [] }, evidence: [], grounding: { version: 1, mode: "verified" } };
};
const candidate = (research_id: string, count = 2): TDeck => ({
  deck_id: crypto.randomUUID(), research_id, revision: 1, title: "Pilot",
  slides: Array.from({ length: count }, (_, index) => ({ slide_id: `s-${index + 1}`, layout: "evidence",
    title: `Finding ${index + 1}`, highlights: [], narration: "Here's what we learned.", evidence_ids: ["M1"] })),
  render_review: { rounds: 1, status: "passed" },
});
const pitch = { slide_count: 2 };
const variant = pitch_variant_key(pitch);
const ready = { probability: 0.95, ready: true, gaps: [] };
const no_research = async () => { throw new Error("This request must not perform gap research."); };

test("count-only preparation returns before the worker, deduplicates, and restores the exact saved result", async () => {
  process.env.AI_SESSION_DB = ":memory:";
  const bundle = research();
  const deck = candidate(bundle.research_id);
  const release = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  let worker_result: Promise<void> | undefined;
  let calls = 0;
  const worker = new DeckPreparationWorker(database, async (input, requested, _services, lifecycle) => {
    expect(input.research_id).toBe(bundle.research_id);
    expect(requested).toEqual(pitch);
    calls++;
    entered.resolve();
    await release.promise;
    lifecycle?.before_render();
    return deck;
  }, { decide: async () => ready, research: no_research });
  const fixture = create_api();
  fixture.use("/api", accounts);
  fixture.use("/api/sessions", create_deck_router(undefined, undefined, create_deck_handler(() => { worker_result ??= worker.tick(); })));
  fixture.use(api_error);
  await using http = await serve_api(fixture);
  let cookie = "";
  const send = (path: string, body?: unknown) => http.request(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(cookie && { Cookie: cookie }), ...(body !== undefined && { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    cookie = (await send("/api/account/register", { email: `${crypto.randomUUID()}@example.test`, password: crypto.randomUUID() }))
      .headers.get("set-cookie")!.split(";", 1)[0];
    const { session_id } = await (await send("/api/projects", { name: "Preparation fixture" })).json();
    const { session_id: other_project } = await (await send("/api/projects", { name: "Another project" })).json();
    expect(database().replace_brief(session_id, undefined, bundle.confirmed_brief)).toBe(true);
    expect(database().save_research(session_id, bundle)).toBe(true);
    const earlier = database().decks.create(session_id, candidate(bundle.research_id, 1), '[4,"context_slides",2]');
    const path = "/api/sessions/" + session_id + "/decks";
    const request = { research_id: bundle.research_id, pitch };
    const accepted = await send(path, request);
    expect(accepted.status).toBe(202);
    const first = await accepted.json();
    expect(first).toMatchObject({ status: "queued" });
    await entered.promise;
    const repeat = await send(path, request);
    expect(repeat.status).toBe(202);
    expect(await repeat.json()).toEqual({ job_id: first.job_id, status: "running" });
    const listing = `${path}?research_id=${bundle.research_id}`;
    expect(await (await send(listing)).json()).toMatchObject({
      preparation: { job_id: first.job_id, slide_count: 2 },
      decks: [{ deck_id: earlier.deck_id }],
    });
    expect((await send("/api/sessions/" + other_project + "/decks/preparations/" + first.job_id)).status).toBe(404);
    expect(database().decks.for_research(session_id, bundle.research_id, variant)).toBeUndefined();
    release.resolve();
    await worker_result;
    const status_url = path + "/preparations/" + first.job_id;
    const completed = await send(status_url);
    expect(completed.headers.get("cache-control")).toBe("private, no-store");
    expect(await completed.json()).toEqual({ job_id: first.job_id, status: "completed", deck });
    const cached = await send(path, request);
    expect(cached.status).toBe(200);
    expect(await cached.json()).toEqual(deck);
    expect(await (await send(path + "/" + deck.deck_id + "?revision=1")).json()).toEqual(deck);
    expect((await (await send(listing)).json()).preparation).toBeUndefined();
    expect(calls).toBe(1);
  } finally { release.resolve(); }
});

test("Decisions routes a public coverage gap through research and rechecks before saving ten slides", async () => {
  const db = new SessionStore(":memory:");
  const bundle = research();
  bundle.confirmed_brief.source_policy = "public_search";
  const passage = "The reading cohort included 18 schools in 2025.";
  bundle.findings.sections = Array.from({ length: 9 }, (_, index) => ({
    heading: `Pilot finding ${index + 1}`, paragraphs: [{ prose: passage, support: [{ evidence_id: "M1", excerpt: passage }] }],
  }));
  bundle.evidence = [{ id: "M1", origin: "material", location: "Pilot report", passage }];
  db.replace_brief("host", undefined, bundle.confirmed_brief);
  db.save_research("host", bundle);
  const count = 10;
  const events: string[] = [];
  const worker = new DeckPreparationWorker(() => db, async (input, requested, _services, lifecycle) => {
    events.push("prepare");
    expect(input.evidence.map(item => item.id)).toEqual(["M1", "P2"]);
    expect(requested).toEqual({ slide_count: count });
    lifecycle?.before_render();
    return candidate(input.research_id, count);
  }, {
    decide: (input, requested, signal) => decide_presentation_readiness(input, requested, signal,
      { key: "fixture", base_url: "https://example.test/v1" }, async (url, init) => {
        expect(url).toEqual("https://example.test/v1/decisions");
        const body = JSON.parse(init.body as string);
        const context = JSON.parse(body.input);
        expect(body.model).toBe("gpt-6-luna");
        expect(context.slide_count).toBe(count);
        expect(context.findings.sections).toHaveLength(9);
        const supplemented = context.passages.length === 2;
        events.push(supplemented ? "recheck" : "decide");
        return Response.json({ model: body.model, answers: [
          { type: "predicate", name: "enough_evidence", probability: supplemented ? 0.96 : 0.1 },
          { type: "choice", name: "largest_gap", choice: "measurements" },
        ] });
      }),
    research: async (input, requested, coverage) => {
      events.push("research");
      expect(requested).toBe(count);
      expect(coverage.gaps[0]).toContain("comparable numbers");
      return { ...input, evidence: [...input.evidence, { id: "P2", origin: "public", location: "Public report",
        url: "https://example.test/report", passage: "The pilot measured 120 completed readings." }] };
    },
  });
  const job = db.deck_preparations.enqueue("host", bundle.research_id, pitch_variant_key({ slide_count: count }), count).job!;
  await worker.tick();
  expect(events).toEqual(["decide", "research", "recheck", "prepare"]);
  expect(db.deck_preparations.get("host", job.job_id)?.deck?.slides).toHaveLength(count);
  expect(db.research_by_id("host", bundle.research_id)).toEqual(bundle);
});

test("files-only gaps and provider errors are retryable and a short deck cannot finish", async () => {
  const db = new SessionStore(":memory:");
  const bundle = research();
  db.replace_brief("host", undefined, bundle.confirmed_brief);
  db.save_research("host", bundle);
  const enqueue = () => db.deck_preparations.enqueue("host", bundle.research_id, variant, pitch.slide_count).job!;
  const read = (id: string) => db.deck_preparations.get("host", id);
  let attempt = 0;
  const worker = new DeckPreparationWorker(() => db, async input => candidate(input.research_id, 1), {
    decide: async () => {
      attempt++;
      if (attempt === 1) return { probability: 0.02, ready: false, gaps: ["Find comparable results."] };
      if (attempt === 2) throw new AppError(503, "Provider unavailable");
      return ready;
    },
    research: no_research,
  });
  const first = enqueue();
  await worker.tick();
  expect(read(first.job_id)).toMatchObject({ status: "failed", error_status: 422, error: expect.stringContaining("Find comparable results") });
  const second = enqueue();
  await worker.tick();
  expect(read(second.job_id)).toMatchObject({ status: "failed", error_status: 503, error: "Provider unavailable" });
  const third = enqueue();
  await worker.tick();
  expect(read(third.job_id)).toMatchObject({ status: "failed", error_status: 422, error: expect.stringContaining("2 slides") });
  expect(db.decks.variants("host", bundle.research_id)).toEqual([]);
  expect(new Set([first.job_id, second.job_id, third.job_id]).size).toBe(3);
});

test("lease recovery fences stale completion and an interrupted browser review cannot replay its passes", () => {
  const db = new SessionStore(":memory:");
  const jobs = db.deck_preparations;
  const created = jobs.enqueue("owner", "research", variant, pitch.slide_count).job!;
  const original = jobs.claim(1_000)!;
  expect(original.job_id).toBe(created.job_id);
  const recovered = jobs.claim(31_001)!;
  expect(recovered.job_id).toBe(original.job_id);
  expect(recovered.lease_token).not.toBe(original.lease_token);
  expect(jobs.renew(original, 31_001)).toBe(false);
  expect(jobs.complete(original, candidate("research"), 31_001)).toBe(false);
  expect(jobs.consume_render_pass(recovered, 31_001)).toBe(true);
  expect(jobs.consume_render_pass(recovered, 31_002)).toBe(true);
  expect(jobs.consume_render_pass(recovered, 31_003)).toBe(true);
  expect(jobs.consume_render_pass(recovered, 31_004)).toBe(false);
  expect(jobs.claim(61_002)).toBeUndefined();
  expect(jobs.get("owner", created.job_id)).toMatchObject({ status: "failed", error_status: 503 });
  expect(jobs.complete(recovered, candidate("research"), 61_002)).toBe(false);
  expect(db.decks.for_research("owner", "research", variant)).toBeUndefined();
  expect(jobs.enqueue("owner", "research", variant, pitch.slide_count).job?.job_id).not.toBe(created.job_id);
});

test("a database created before render review gains its column, so queued decks can still be claimed", () => {
  const path = tmpdir() + "/deck-prep-" + crypto.randomUUID() + ".sqlite";
  const legacy = new Database(path);
  legacy.exec(`CREATE TABLE deck_preparations (
    job_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, research_id TEXT NOT NULL, variant TEXT NOT NULL,
    slide_count INTEGER NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    lease_token TEXT, lease_until INTEGER, deck_id TEXT, error TEXT, error_status INTEGER)`);
  legacy.query("INSERT INTO deck_preparations(job_id,session_id,research_id,variant,slide_count,status) VALUES(?,?,?,?,?,?)")
    .run("job-1", "host", "research-1", "[4,\"context_slides\",3]", 3, "queued");
  legacy.close();
  const store = new SessionStore(path);
  expect(store.deck_preparations.claim()?.job_id).toBe("job-1");
});
