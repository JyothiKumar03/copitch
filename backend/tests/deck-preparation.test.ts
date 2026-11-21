import { expect, test } from "bun:test";
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
import { serve_api } from "./helpers/serve-api";

const research = (): TResearchBundle => {
  const brief: TResearchBrief = { brief_id: crypto.randomUUID(), summary: "Present the pilot", messages: [], materials: "",
    source_policy: "files_only", urls: [], public_queries: [], question: null };
  return { research_id: crypto.randomUUID(), brief_id: brief.brief_id, confirmed_brief: brief, gaps: [],
    findings: { title: "Pilot", sections: [] }, evidence: [], grounding: { version: 1, mode: "verified" } };
};
const candidate = (research_id: string): TDeck => ({
  deck_id: crypto.randomUUID(), research_id, revision: 1, title: "Pilot", slides: [],
  render_review: { rounds: 1, status: "passed" },
});
const pitch = { slide_count: 2 };
const variant = pitch_variant_key(pitch);

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
  });
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
    expect(calls).toBe(1);
  } finally { release.resolve(); }
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
  const { Database } = require("bun:sqlite") as typeof import("bun:sqlite");
  const path = require("node:os").tmpdir() + "/deck-prep-" + crypto.randomUUID() + ".sqlite";
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
