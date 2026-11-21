import { interview_workspace } from "../src/services/interview";
import { api_error } from "../src/middleware/api-error";
import { create_api } from "../src/app";
import { serve_api } from "./helpers/serve-api";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { research_handlers } from "../src/controllers/research";
import { create_session } from "../src/controllers/session";
import { database } from "../src/repositories/store";
import { SessionStore } from "../src/repositories/session";
import { ResearchWorker } from "../src/workers/research";
import type { TResearchBrief, TResearchProvider } from "../src/types/research";

const new_brief = (): TResearchBrief => ({
  brief_id:crypto.randomUUID(), source_policy:"public_search", public_queries:["first","second"], urls:[],
  messages:["Describe the pilot."], materials:"A trial ran.", summary:"Describe the pilot.", question:null,
});

const provider = (queries: string[]): TResearchProvider => {
  return {
    clarify: async () => ({ summary:"Pilot",question:null,public_queries:["first","second"] }),
    lookup: async query => { queries.push(query); return [{ title:query,url:"https://example.com/" + query,passage:"The pilot ran." }]; },
    verify: async review => review.units.map(unit => ({ id: unit.id, decision: "supported" })),
    draft: async () => ({ title:"Pilot",sections:[{ heading:"Trial",paragraphs:[{
      prose:"A trial ran.",support:[{evidence_id:"M1",excerpt:"A trial ran."}],
    }] }],gaps:[] }),
  };
};

test("reopened worker recovers the last completed lookup and an expired holder cannot publish", async () => {
  const path = await mkdtemp(join(tmpdir(),"research-jobs-"));
  try {
    const file = join(path,"state.sqlite");
    const original = new SessionStore(file);
    const brief = new_brief();
    original.replace_brief("host",undefined,brief);
    const job = original.research_jobs.enqueue("host",brief.brief_id);
    // The child owns a live lease, checkpoints a completed provider call, and exits without releasing it.
    // A fixed earlier clock makes its lease expire before reopening, without slowing this test by 15 seconds.
    const child = Bun.spawnSync([process.execPath,"-e",`
      import {SessionStore} from ${JSON.stringify(new URL("../src/repositories/session.ts",import.meta.url).pathname)};
      const at = Date.now() - 30000;
      Date.now = () => at;
      const db = new SessionStore(process.argv[1]);
      const first = db.research_jobs.claim(process.argv[2]);
      db.research_jobs.checkpoint(first,{ completed_lookups:1,gaps:[],evidence:[
        {id:"M1",location:"Host attachment",origin:"material",passage:"A trial ran."},
        {id:"P1",location:"First lookup",origin:"public",url:"https://example.com/first",passage:"The pilot ran."},
      ] });
      console.log(JSON.stringify(first));
      process.exit(0);
    `,file,job.job_id]);
    expect(child.exitCode, child.stderr.toString()).toBe(0);
    const first = JSON.parse(child.stdout.toString());
    const reopened = new SessionStore(file);
    const called: string[] = [];
    const recovery = new ResearchWorker(() => reopened,() => provider(called));
    recovery.start();
    try {
      for (let i = 0; i < 50 && reopened.research_jobs.get("host",job.job_id)?.status !== "completed"; i++) await Bun.sleep(5);
    } finally { recovery.stop(); }
    expect(called).toEqual(["second"]);
    const saved = reopened.research_jobs.get("host",job.job_id)!;
    expect(saved.activity.map(item => item.kind)).toEqual(["queued","started","resumed","lookup_requested","sources_saved","draft_started","verification_started","verified","completed"]);
    expect(reopened.research_jobs.enqueue("host",brief.brief_id).activity).toEqual(saved.activity);
    expect(() => original.research_jobs.record(first,"search_completed","Expired worker")).toThrow("lease");
    expect(saved.status).toBe("completed");
    expect(saved.completed_lookups).toBe(2);
    expect(saved.result?.markdown).toContain("A trial ran.");
    expect(reopened.research_jobs.enqueue("host",brief.brief_id).result?.research_id).toBe(saved.result?.research_id);
    expect(reopened.research_jobs.get("another",job.job_id)).toBeUndefined();
    expect(() => original.research_jobs.checkpoint(first,{completed_lookups:0,evidence:[],gaps:[]})).toThrow("lease");
    const saved_bundle = reopened.research_by_brief("host",brief.brief_id)!;
    expect(() => original.research_jobs.complete(first,saved_bundle)).toThrow("lease");
    expect(saved_bundle.evidence.some(item => item.id === "P1")).toBe(true);
  } finally { await rm(path,{recursive:true,force:true}); }
});

test("scope corrections fence in-flight work, failures are bounded and explicit retry reuses the job", async () => {
  const store = new SessionStore(":memory:");
  const brief = new_brief();
  store.replace_brief("host",undefined,brief);
  const jobs = store.research_jobs;
  const job = jobs.enqueue("host",brief.brief_id);
  let now = Date.now();
  for (let i = 0; i < 3; i++) {
    const lease = jobs.claim(job.job_id,now)!;
    jobs.fail(lease,"Provider unavailable",now);
    now += 1001;
  }
  expect(jobs.get("host",job.job_id)?.status).toBe("failed");
  expect(jobs.claim(job.job_id,now)).toBeUndefined();
  expect(jobs.enqueue("host",brief.brief_id,true).job_id).toBe(job.job_id);
  const lease = jobs.claim(job.job_id)!;
  const next = new_brief();
  store.replace_brief("host",brief.brief_id,next);
  expect(jobs.get("host",job.job_id)?.status).toBe("superseded");
  expect(jobs.renew(lease)).toBe(false);
  expect(() => jobs.assert_owner(lease)).toThrow("scope changed");
  expect(() => jobs.enqueue("host",brief.brief_id)).toThrow("stale");
  expect(store.research_by_brief("host",brief.brief_id)).toBeUndefined();
});

test("async confirmation returns before work finishes and job survives caller disconnect", async () => {
  process.env.AI_SESSION_DB = ":memory:";
  const calls: string[] = [];
  const fake = provider(calls);
  const lookup = fake.lookup;
  fake.lookup = async (query,url,signal,observed) => {
    observed?.("search");
    return lookup(query,url,signal);
  };
  const synthesize = fake.draft;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  fake.draft = async (...args) => { await gate; return synthesize(...args); };
  const handlers = research_handlers(() => fake);
  const app = create_api();
  app.post("/sessions",create_session);
  app.post("/:session_id/build",handlers.build);
  app.get("/:session_id/jobs/:job_id",handlers.job);
  app.use(api_error);
  await using http = await serve_api(app);
  const host = await (await http.request("/sessions",{method:"POST"})).json();
  const brief = new_brief();
  database().replace_brief(host.session_id,undefined,brief);
  const abort = new AbortController();
  const headers = { Authorization:"Bearer " + host.token,"Content-Type":"application/json",Prefer:"respond-async" };
  const confirm = () => http.request("/" + host.session_id + "/build",{method:"POST",headers,
    body:JSON.stringify({confirmed:true,brief_id:brief.brief_id}),signal:abort.signal});
  const res = await confirm();
  expect(res.status).toBe(202);
  const {job_id} = await res.json();
  expect((await (await confirm()).json()).job_id).toBe(job_id);
  abort.abort();
  const status = async () => (await http.request("/" + host.session_id + "/jobs/" + job_id,{headers})).json();
  const during = await status();
  expect(during.status).toBe("running");
  expect(during.activity.map((item:{kind:string}) => item.kind)).toEqual(["queued","started","lookup_requested","search_completed","sources_saved","lookup_requested","search_completed","sources_saved","draft_started"]);
  expect(interview_workspace(host.session_id).job?.activity).toEqual(during.activity);
  expect(during.activity.map((item:{sequence:number}) => item.sequence)).toEqual([1,2,3,4,5,6,7,8,9]);
  release();
  for (let i = 0; i < 50 && (await status()).status === "running"; i++) await Bun.sleep(5);
  const final = await status();
  expect(final.status).toBe("completed");
  expect(final.result.research_id).toBeTruthy();
  expect(calls).toEqual(["first","second"]);
});

test("files-only fallback records neither hosted tool use nor a verifier invocation", async () => {
  const db = new SessionStore(":memory:");
  const brief: TResearchBrief = {...new_brief(),source_policy:"files_only",materials:"private-canary",urls:["https://example.org/private-canary"]};
  db.replace_brief("host",undefined,brief);
  const job = db.research_jobs.enqueue("host",brief.brief_id);
  const calls: string[] = [];
  const worker = new ResearchWorker(() => db,() => ({...provider(calls),verify:undefined}));
  await worker.tick(job.job_id);
  const history = db.research_jobs.for_brief("host",brief.brief_id)!.activity;
  expect(history.map(item => item.kind)).toEqual(["queued","started","draft_started","fallback","completed"]);
  expect(JSON.stringify(history)).not.toContain("private-canary");
  expect(calls).toEqual([]);
});
