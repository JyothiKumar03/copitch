import { expect, test } from "bun:test";
import { SessionStore } from "../src/repositories/session";
import { approve_mission, halt_mission, sync_mission_proposal } from "../src/services/director";
import { interview_workspace } from "../src/services/interview";
import { initial_studio_context } from "../src/services/studio-state";
import type { TResearchBundle } from "../src/types/research";

const approve = (db: SessionStore, session = "owner") => {
  const state = initial_studio_context();
  state.goal = "Introduce Mira";
  state.phase = "proposed";
  state.source_policy = "files_only";
  state.materials = "Mira creates customer onboarding guides.";
  state.proposal = { proposal_id: crypto.randomUUID(), summary: "Present the team", urls: [], queries: [], source_policy: "files_only",
    intent: { subject: "Mira", audience: "New teammates", outcome: "Introduce Mira’s work", deliverable: "6 slides" } };
  db.studio.seed(session,state,[]);
  const plan = sync_mission_proposal(db,session,state,["Introduce Mira’s work to new teammates in 6 slides."])!;
  return approve_mission(db,session,plan.mission_id,plan.contract.revision);
};

const bundle_for = (db: SessionStore, session: string): TResearchBundle => {
  const brief = db.current_brief(session)!;
  return { research_id: crypto.randomUUID(), brief_id: brief.brief_id, confirmed_brief: brief,
    findings: { title: "Mira", sections: [] }, evidence: [], gaps: [] };
};

test("Stop writes one terminal receipt and fences only the current approved research child", () => {
  const db = new SessionStore(":memory:");
  const mission = approve(db);
  const job_id = mission.research_job_id!;
  const other_brief = { ...db.current_brief("owner")!, brief_id: crypto.randomUUID() };
  expect(db.replace_brief("other",undefined,other_brief)).toBe(true);
  const manual = db.research_jobs.enqueue("other",other_brief.brief_id);
  expect(interview_workspace("owner",db).phase).toBe("researching");
  expect(() => halt_mission(db,"owner",mission.mission_id,2,"stop")).toThrow("changed");
  expect(db.research_jobs.get("owner",job_id)?.status).toBe("queued");
  const stopped = halt_mission(db,"owner",mission.mission_id,1,"stop");
  expect(stopped.status).toBe("stopped");
  expect(stopped.research_job_id).toBe(job_id);
  expect(halt_mission(db,"owner",mission.mission_id,1,"stop")).toEqual(stopped);
  const job = db.research_jobs.get("owner",job_id)!;
  expect(job.status).toBe("stopped");
  expect(job.activity.filter(event => event.kind === "stopped")).toHaveLength(1);
  expect(db.research_jobs.claim(job_id)).toBeUndefined();
  expect(interview_workspace("owner",db).phase).toBe("done");
  expect(db.research_jobs.get("other",manual.job_id)?.status).toBe("queued");
});

test("Take over fences a leased child and preserves its checkpoint and completed research", () => {
  const db = new SessionStore(":memory:");
  const mission = approve(db);
  const job_id = mission.research_job_id!;
  const lease = db.research_jobs.claim(job_id)!;
  const bundle = bundle_for(db,"owner");
  const checkpoint = { completed_lookups: 2, evidence: [], gaps: [] };
  db.research_jobs.checkpoint(lease,checkpoint);
  const paused = halt_mission(db,"owner",mission.mission_id,1,"take-over");
  expect(paused.status).toBe("paused");
  expect(db.research_jobs.get("owner",job_id)?.completed_lookups).toBe(2);
  expect(db.research_jobs.renew(lease)).toBe(false);
  expect(() => db.research_jobs.complete(lease,bundle)).toThrow("lease or scope changed");
  expect(db.research_by_id("owner",bundle.research_id)).toBeUndefined();

  const other = approve(db,"completed");
  const saved = bundle_for(db,"completed");
  db.research_jobs.complete(db.research_jobs.claim(other.research_job_id!)!,saved);
  halt_mission(db,"completed",other.mission_id,1,"take-over");
  expect(db.research_by_id("completed",saved.research_id)).toEqual(saved);
  expect(db.research_jobs.get("completed",other.research_job_id!)?.status).toBe("completed");
});

test("Stop fences the last approved child during scope review and leaves a new manual research child alone", () => {
  const db = new SessionStore(":memory:");
  const mission = approve(db);
  const queued = mission.research_job_id!;
  db.missions.revise("owner",mission.mission_id,1,{ ...mission.contract, audience: "Pilot supervisors" });
  halt_mission(db,"owner",mission.mission_id,2,"stop");
  expect(db.research_jobs.get("owner",queued)?.status).toBe("stopped");
  expect(db.missions.current("owner")?.approved_revision).toBe(1);

  const legacy = approve(db,"same-session");
  const brief = db.current_brief("same-session")!;
  const manual_brief = { ...brief, brief_id: crypto.randomUUID() };
  expect(db.replace_brief("same-session",brief.brief_id,manual_brief)).toBe(true);
  const manual = db.research_jobs.enqueue("same-session",manual_brief.brief_id);
  halt_mission(db,"same-session",legacy.mission_id,1,"stop");
  expect(db.research_jobs.get("same-session",legacy.research_job_id!)?.status).toBe("superseded");
  expect(db.research_jobs.get("same-session",manual.job_id)?.status).toBe("queued");
});
