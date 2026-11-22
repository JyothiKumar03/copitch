import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppError } from "../src/errors/app-error";
import { ensure_retry_provider, mission_view, retry_mission } from "../src/services/mission-retry";
import { SessionStore } from "../src/repositories/session";
import { adopt_host_deck_request, approve_mission, outcome_gaps, sync_mission_proposal } from "../src/services/director";
import { MissionWorker } from "../src/workers/mission";
import { initial_studio_context } from "../src/services/studio-state";
import type { TResearchBundle } from "../src/types/research";
import type { TDeck } from "../src/types/deck";
import { contract_schema } from "../src/types/mission";

const propose = (db: SessionStore) => {
  const request = "Build two slides for new teammates. I love classical music and mangoes.";
  const state = initial_studio_context();
  state.goal = "Introduce Mira";
  state.phase = "proposed";
  state.source_policy = "files_only";
  state.factual_notes = ["I love classical music and mangoes."];
  state.proposal = { proposal_id: crypto.randomUUID(), summary: state.goal, urls: [], queries: [], source_policy: "files_only",
    intent: { subject: "Mira", audience: "New teammates", outcome: "Introduce Mira's work and interests", deliverable: "2 slides" } };
  db.studio.seed("owner",state,[]);
  return sync_mission_proposal(db,"owner",state,[request])!;
};
const finish_research = (db: SessionStore, job_id: string) => {
  const brief = db.current_brief("owner")!;
  const bundle: TResearchBundle = { research_id: crypto.randomUUID(), confirmed_brief: brief, brief_id: brief.brief_id,
    findings: { title: "Mira", sections: [] }, gaps: [], evidence: [
      { id: "H1", origin: "host", location: "Host note", passage: "I love classical music and mangoes." }] };
  db.research_jobs.complete(db.research_jobs.claim(job_id)!,bundle);
  return bundle;
};
const reviewed = (bundle: TResearchBundle): TDeck => ({
  research_id: bundle.research_id, title: "Mira", deck_id: crypto.randomUUID(), revision: 1,
  render_review: { status: "passed", rounds: 1 },
  slides: ["Classical music","Mangoes"].map((title,i) => ({ title, slide_id: String(i), highlights: [],
    narration: title + ".", evidence_ids: ["H1"], layout: "headline" })),
});
const fixture_decide = async () => ({ tool: "prepare_deck" as const, reason: "The approved passages cover both topics.", question: null });
const fixture_judge = async () => ({ pass: true, gaps: [] });

test("a five-dollar plan can be edited and approved without accepting a higher spend", () => {
  const original = process.env.MISSION_BUDGET_USD;
  process.env.MISSION_BUDGET_USD = "5";
  try {
    const db = new SessionStore(":memory:");
    const { mission_id, contract } = propose(db);
    expect(contract.budget.usd).toBe(5);
    const proposed_edit = contract_schema.parse({ ...contract, audience: "New instructors" });
    expect(contract_schema.safeParse({ ...proposed_edit, budget: { ...contract.budget, usd: 5.01 } }).success).toBe(false);
    expect(contract_schema.safeParse({ ...proposed_edit, budget: { ...contract.budget, usd: 2 } }).success).toBe(true);
    const revised = db.missions.revise("owner", mission_id, contract.revision, proposed_edit);
    const approved = approve_mission(db, "owner", mission_id, revised.contract.revision);
    expect(approved.contract.budget.usd).toBe(5);
    expect(approved.research_job_id).toBeTruthy();
  } finally {
    if (original === undefined) delete process.env.MISSION_BUDGET_USD;
    else process.env.MISSION_BUDGET_USD = original;
  }
});

test("one outcome approval produces the exact cited deck after reopening the database at the child checkpoint", async () => {
  const directory = await mkdtemp(join(tmpdir(),"copitch-director-"));
  try {
    const path = join(directory,"fixture.sqlite");
    const original = new SessionStore(path);
    const plan = propose(original);
    const accepted = approve_mission(original,"owner",plan.mission_id,plan.contract.revision);
    expect(approve_mission(original,"owner",plan.mission_id,1).research_job_id).toBe(accepted.research_job_id);
    const bundle = finish_research(original,accepted.research_job_id!);
    // Terminate the isolated API worker after its child enqueue has committed, before
    // the new process has any opportunity to observe or finish slide preparation.
    const store_path = new URL("../src/repositories/session.ts",import.meta.url).pathname;
    const worker_path = new URL("../src/workers/mission.ts",import.meta.url).pathname;
    const child = Bun.spawnSync([process.execPath,"-e",`
      import { AppError } from "../src/errors/app-error";
import { ensure_retry_provider, mission_view, retry_mission } from "../src/services/mission-retry";
import { SessionStore } from ${JSON.stringify(store_path)};
      import { MissionWorker } from ${JSON.stringify(worker_path)};
      const db = new SessionStore(process.argv[1]);
      const worker = new MissionWorker(() => db,async () => ({pass:true,gaps:[]}),async () =>
        ({tool:"prepare_deck",reason:"The two approved facts cover the requested slides.",question:null}));
      await worker.tick();
      process.exit(0);
    `,path]);
    expect(child.exitCode,child.stderr.toString()).toBe(0);
    const preparing = original.missions.current("owner")!;
    expect(preparing.deck_job_id).toBeTruthy();
    const reopened = new SessionStore(path);
    const worker = new MissionWorker(() => reopened,fixture_judge,fixture_decide);
    worker.start();
    worker.stop();
    await Bun.sleep(0);
    const lease = reopened.deck_preparations.claim()!;
    expect(lease.job_id).toBe(preparing.deck_job_id!);
    const deck = reviewed(bundle);
    reopened.deck_preparations.complete(lease,deck);
    await worker.tick();
    const saved = reopened.missions.current("owner")!;
    expect(saved.steps.filter(step => step.tool === "prepare_deck")).toHaveLength(1);
    expect(saved.steps.some(step => step.tool === "resume")).toBe(true);
    expect(saved.status).toBe("delivered");
    expect(saved.deck_revision).toBe(1);
    expect(saved.deck_id).toBe(deck.deck_id);
    expect(saved.contract.must_include).toEqual([{ text: "I love classical music and mangoes.", source: "host" }]);
    expect(saved.contract.deliverable.slide_count).toBe(2);
    expect(reopened.missions.current("stranger")).toBeNull();
    expect(() => reopened.missions.get("stranger",saved.mission_id)).toThrow("unavailable");
    expect(reopened.decks.get("stranger",deck.deck_id)).toBeUndefined();
  } finally { await rm(directory,{ recursive: true, force: true }); }
});

test("scope revision invalidates stale approval and prevents the earlier child from spending", () => {
  const db = new SessionStore(":memory:");
  const plan = propose(db);
  const accepted = approve_mission(db,"owner",plan.mission_id,1);
  const meter = db.missions.mission_meter("owner",accepted.research_job_id!)!;
  const reserved = 1.5;
  const first = meter.reserve(reserved);
  const remaining = plan.contract.budget.usd - reserved;
  expect(() => meter.reserve(remaining + 0.01)).toThrow("budget");
  meter.settle(first,0.2);
  meter.settle(first,0.1);
  const changed = db.missions.revise("owner",plan.mission_id,1,{ ...plan.contract, audience: "Students" });
  expect(changed.status).toBe("needs_approval");
  expect(changed.spent_usd).toBe(0.2);
  expect(changed.previous_contract?.audience).toBe("New teammates");
  expect(() => meter.assert_active()).toThrow("expired");
  expect(() => approve_mission(db,"owner",plan.mission_id,1)).toThrow("changed");
  const next = approve_mission(db,"owner",plan.mission_id,2);
  expect(next.research_job_id).not.toBe(accepted.research_job_id);
  expect(db.research_jobs.get("owner",accepted.research_job_id!)?.status).toBe("superseded");
  expect(() => meter.reserve(0.1)).toThrow();
  expect(next.approved_revision).toBe(2);
});

test("delivery cannot substitute material for a required host fact, an unsupported number, or partial layout", () => {
  const db = new SessionStore(":memory:");
  const plan = propose(db);
  const mission = approve_mission(db,"owner",plan.mission_id,1);
  const bundle = finish_research(db,mission.research_job_id!);
  const deck = reviewed(bundle);
  mission.research_id = bundle.research_id;
  expect(outcome_gaps(mission,deck,bundle)).toEqual([]);
  bundle.evidence[0].origin = "material";
  deck.slides[0].highlights = ["25 recordings"];
  deck.render_review = undefined;
  const gaps = outcome_gaps(mission,deck,bundle).join(" ");
  expect(gaps).toContain("render review");
  expect(gaps).toContain("figures");
  expect(gaps).toContain("host’s statement");
});

test("the Director requests a missing prerequisite before starting slide generation", async () => {
  const db = new SessionStore(":memory:");
  const plan = propose(db);
  const mission = approve_mission(db,"owner",plan.mission_id,1);
  finish_research(db,mission.research_job_id!);
  const worker = new MissionWorker(() => db,fixture_judge,async () => ({
    tool: "ask_host", reason: "The approved file has no project examples.", question: "Which project should the introduction feature?" }));
  await worker.tick();
  await worker.tick();
  const saved = db.missions.current("owner")!;
  expect(saved.status).toBe("needs_input");
  expect(saved.gaps[0]).toBe("Which project should the introduction feature?");
  expect(saved.deck_job_id).toBeNull();
  expect(saved.steps.filter(step => step.tool === "ask_host")).toHaveLength(1);
});

test("an explicitly approved public walkthrough runs once with half the mission budget before research", async () => {
  const db = new SessionStore(":memory:");
  const plan = propose(db);
  const task = { mode: "read" as const, url: "https://example.com/", goal: "Read the project overview" };
  const revision = db.missions.revise("owner",plan.mission_id,1,{ ...plan.contract,
    sources: { ...plan.contract.sources, public_search: false, site_tasks: [task] } });
  const mission = approve_mission(db,"owner",plan.mission_id,revision.contract.revision);
  const replay = approve_mission(db,"owner",plan.mission_id,revision.contract.revision);
  expect(replay.site_run_id).toBe(mission.site_run_id);
  expect(mission.research_job_id).toBeNull();
  const site = db.site_runs.get("owner",mission.site_run_id!)!;
  // Without a priced browse model the run falls back to the browser engine; the allowance is still half the mission budget.
  expect(site.engine).toBe(process.env.OPENAI_API_KEY ? "model" : "browser");
  expect(site.budget_usd).toBe(revision.contract.budget.usd / 2);
  const lease = db.site_runs.claim()!;
  lease.checkpoint.steps.push({ n: 1, depth: 0, url: task.url, title: "Project overview", caption: "Opened the overview", facts: ["Mira built the project."] });
  db.site_runs.checkpoint(lease,lease.checkpoint,{ n: 1,bytes: Buffer.from("synthetic image") });
  db.site_runs.complete(lease,"Recorded the overview.",Buffer.from("synthetic presentation"));
  const worker = new MissionWorker(() => db,fixture_judge,fixture_decide);
  await worker.tick();
  await worker.tick();
  const research = db.missions.current("owner")!;
  expect(research.research_job_id).toBeTruthy();
  expect(db.current_brief("owner")!.sources?.map(source => source.source_id)).toContain(site.run_id);
  expect(research.steps.filter(step => step.tool === "research")).toHaveLength(1);
  expect(db.current_brief("owner")!.source_policy).toBe("files_only");
});

test("an arriving host turn fences a pending Director choice and reuses it only when the same scope survives", async () => {
  for (const revise of [true,false]) {
    const db = new SessionStore(":memory:");
    const plan = propose(db);
    const accepted = approve_mission(db,"owner",plan.mission_id,1);
    finish_research(db,accepted.research_job_id!);
    const turn_id = crypto.randomUUID();
    let calls = 0;
    const worker = new MissionWorker(() => db,fixture_judge,async () => {
      calls++;
      db.missions.begin_turn("owner",plan.mission_id,1,turn_id);
      return fixture_decide();
    });
    await worker.tick();
    expect(db.missions.current("owner")!.deck_job_id).toBeNull();
    if (revise) db.missions.revise("owner",plan.mission_id,1,{ ...plan.contract, audience: "Friends" });
    db.missions.end_turn("owner",turn_id);
    await worker.tick();
    const current = db.missions.current("owner")!;
    expect(calls).toBe(1);
    if (revise) expect(current.deck_job_id).toBeNull();
    else expect(current.deck_job_id).toBeTruthy();
  }
});

const fail_research = (db: SessionStore, id: string) => {
  const now = Date.now();
  for (let attempt = 0; attempt < 3; attempt++) {
    const at = now + attempt * 2500;
    db.research_jobs.fail(db.research_jobs.claim(id,at)!,"Configure OPENAI_API_KEY and OPENAI_TEXT_MODELS",at);
  }
};

test("retry retains the approved research checkpoint, rejects another owner, and consumes one receipt across replays", async () => {
  const db = new SessionStore(":memory:");
  const plan = propose(db);
  const approved = approve_mission(db,"owner",plan.mission_id,1);
  const original_id = approved.research_job_id!;
  const meter = db.missions.mission_meter("owner",original_id)!;
  meter.settle(meter.reserve(0.3),0.08,0.02);
  fail_research(db,original_id);
  const worker = new MissionWorker(() => db,fixture_judge,fixture_decide);
  await worker.tick();
  const paused = db.missions.current("owner")!;
  // Older persisted messages may have exposed the configuration names.
  paused.gaps = ["Configure OPENAI_API_KEY and OPENAI_TEXT_MODELS"];
  paused.steps.at(-1)!.summary = paused.gaps[0];
  db.missions.save("owner",paused);
  const view = mission_view(db,"owner",paused);
  expect(JSON.stringify(view)).not.toContain("OPENAI_");
  expect(db.research_jobs.get("owner",original_id)?.error).not.toContain("OPENAI_");
  expect(view.retry?.phase).toBe("research");
  const id = view.retry!.retry_id;
  const unavailable = () => { throw new AppError(503,"Research is still unavailable."); };
  expect(() => retry_mission(db,"owner",plan.mission_id,1,id,unavailable)).toThrow("unavailable");
  expect(db.research_jobs.get("owner",original_id)?.status).toBe("failed");
  expect(() => retry_mission(db,"other",plan.mission_id,1,id,() => {})).toThrow("unavailable");
  let preflights = 0;
  const available = () => { preflights++; };
  const retry = retry_mission(db,"owner",plan.mission_id,1,id,available);
  expect(retry.status).toBe("working");
  expect(retry.contract).toEqual(plan.contract);
  expect(retry.started_at).toBe(approved.started_at);
  expect(retry.spent_usd).toBe(0.08);
  expect(retry.reserved_usd).toBe(0.02);
  expect(retry.research_job_id).toBe(original_id);
  expect(retry_mission(db,"owner",plan.mission_id,1,id,available).status).toBe("working");
  expect(preflights).toBe(1);
  fail_research(db,original_id);
  await worker.tick();
  expect(mission_view(db,"owner",db.missions.current("owner")!).retry).toBeNull();
  expect(retry_mission(db,"owner",plan.mission_id,1,id,available).status).toBe("needs_input");
  expect(preflights).toBe(1);
  db.missions.revise("owner",plan.mission_id,1,{ ...plan.contract, audience: "Another audience" });
  expect(() => retry_mission(db,"owner",plan.mission_id,1,id,available)).toThrow("changed");
});

test("preparation retries only a transient deck child and review retries only its verdict", async () => {
  const db = new SessionStore(":memory:");
  const plan = propose(db);
  const approved = approve_mission(db,"owner",plan.mission_id,1);
  const research = finish_research(db,approved.research_job_id!);
  let reviews = 0;
  let decisions = 0;
  const worker = new MissionWorker(() => db,async () => {
    if (++reviews === 1) throw new AppError(503,"provider offline");
    return fixture_judge();
  },async () => { decisions++; return fixture_decide(); });
  await worker.tick();
  const lease = db.deck_preparations.claim()!;
  db.deck_preparations.fail(lease,{ reason_code: "provider_unavailable", message: "Offline", gaps: [],supported_slide_count: 0 },503);
  await worker.tick();
  const retry = mission_view(db,"owner",db.missions.current("owner")!).retry!;
  expect(retry.phase).toBe("preparation");
  const next = retry_mission(db,"owner",plan.mission_id,1,retry.retry_id,() => {});
  expect(next.deck_job_id).not.toBe(lease.job_id);
  expect(next.research_id).toBe(research.research_id);
  expect(retry_mission(db,"owner",plan.mission_id,1,retry.retry_id,() => {}).deck_job_id).toBe(next.deck_job_id);
  const deck = reviewed(research);
  db.deck_preparations.complete(db.deck_preparations.claim()!,deck);
  await worker.tick();
  const check = mission_view(db,"owner",db.missions.current("owner")!);
  expect(check.retry?.phase).toBe("review");
  expect(check.deck_id).toBe(deck.deck_id);
  retry_mission(db,"owner",plan.mission_id,1,check.retry!.retry_id,() => {});
  await worker.tick();
  const finished = db.missions.current("owner")!;
  expect(finished.status).toBe("delivered");
  expect(finished.deck_job_id).toBe(next.deck_job_id);
  expect(finished.research_job_id).toBe(approved.research_job_id);
  expect(decisions).toBe(1);
  expect(reviews).toBe(2);
});

test("expired allowances, a replaced research brief, and evidence gaps cannot dispatch retries", async () => {
  for (const reason of ["time","funds","scope","evidence"]) {
    const db = new SessionStore(":memory:");
    const plan = propose(db);
    const mission = approve_mission(db,"owner",plan.mission_id,1);
    const worker = new MissionWorker(() => db,fixture_judge,fixture_decide);
    if (reason === "evidence") {
      db.research_jobs.request_input(db.research_jobs.claim(mission.research_job_id!)!,"Which file covers this topic?");
    } else fail_research(db,mission.research_job_id!);
    await worker.tick();
    const blocked = db.missions.current("owner")!;
    const seen = mission_view(db,"owner",blocked).retry?.retry_id ?? "stale";
    if (reason === "time") blocked.started_at = Date.now()-700000;
    if (reason === "funds") blocked.reserved_usd = blocked.contract.budget.usd;
    if (reason === "scope") {
      const previous = db.current_brief("owner")!;
      db.replace_brief("owner",previous.brief_id,{...previous,brief_id:crypto.randomUUID()});
    }
    db.missions.save("owner",blocked);
    expect(mission_view(db,"owner",blocked).retry).toBeNull();
    expect(() => retry_mission(db,"owner",blocked.mission_id,1,seen,() => {})).toThrow("no longer available");
  }
});


test("a planning checkpoint retries once without repeating research; unpriced models fail before transport", async () => {
  expect(() => ensure_retry_provider("plan",() => [{ model: "fixture", provider: "openai", max_output_tokens: 100,
    tool_providers: ["session"] }],true)).toThrow("still unavailable");
  const db = new SessionStore(":memory:");
  const plan = propose(db);
  const mission = approve_mission(db,"owner",plan.mission_id,1);
  const bundle = finish_research(db,mission.research_job_id!);
  let attempts = 0;
  const worker = new MissionWorker(() => db,fixture_judge,async () => {
    if (++attempts === 1) throw new AppError(503,"Offline");
    return fixture_decide();
  });
  await worker.tick();
  const retry = mission_view(db,"owner",db.missions.current("owner")!).retry!;
  expect(retry.phase).toBe("plan");
  retry_mission(db,"owner",plan.mission_id,1,retry.retry_id,() => {});
  await worker.tick();
  await worker.tick();
  const resumed = db.missions.current("owner")!;
  expect(resumed.research_id).toBe(bundle.research_id);
  expect(resumed.deck_job_id).toBeTruthy();
  expect(resumed.steps.filter(step => step.tool === "prepare_deck")).toHaveLength(1);
  expect(attempts).toBe(2);
});

test("asking for the same slides again resumes a waiting mission on the new preparation", async () => {
  const db = new SessionStore(":memory:");
  const plan = propose(db);
  const mission = approve_mission(db,"owner",plan.mission_id,1);
  const bundle = finish_research(db,mission.research_job_id!);
  const worker = new MissionWorker(() => db,fixture_judge,async () => ({
    tool: "ask_host", reason: "Slide preparation needs another pass.", question: "Would you like to review the supported slides?" }));
  await worker.tick();
  await worker.tick();
  expect(db.missions.current("owner")!.status).toBe("needs_input");
  // A different count or research revision is a new request, not this mission's deck.
  expect(adopt_host_deck_request(db,"owner",bundle.research_id,5,{ job: { job_id: crypto.randomUUID() } })).toBeUndefined();
  expect(adopt_host_deck_request(db,"owner",crypto.randomUUID(),2,{ job: { job_id: crypto.randomUUID() } })).toBeUndefined();
  const { job } = db.deck_preparations.enqueue("owner",bundle.research_id,"slides-2",2);
  adopt_host_deck_request(db,"owner",bundle.research_id,2,{ job });
  const resumed = db.missions.current("owner")!;
  expect(resumed.status).toBe("working");
  expect(resumed.gaps).toEqual([]);
  expect(resumed.deck_job_id).toBe(job!.job_id);
  expect(resumed.steps.at(-1)?.tool).toBe("prepare_deck");
});

test("an approved revision gets a fresh time allowance instead of inheriting an expired one", () => {
  const db = new SessionStore(":memory:");
  const plan = propose(db);
  // An earlier approved revision started an hour ago; approving this one must not inherit that clock.
  const stale = db.missions.current("owner")!;
  stale.started_at = Date.now() - 60 * 60_000;
  db.missions.save("owner",stale);
  const before = Date.now();
  const approved = approve_mission(db,"owner",plan.mission_id,1);
  expect(approved.started_at!).toBeGreaterThanOrEqual(before);
});
