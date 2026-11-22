import { z } from "zod";
import { Router } from "express";
import type { Request } from "express";
import { AppError } from "../errors/app-error";
import { current_account } from "../middleware/account";
import { database } from "../repositories/store";
import { studio_context } from "../services/studio-state";
import { ensure_retry_provider, mission_view, retry_mission } from "../services/mission-retry";
import type { RequestHandler } from "express";
import { approve_mission, halt_mission } from "../services/director";
import { mission_revision, mission_revision_input } from "../types/mission";
import { MissionWorker } from "../workers/mission";

export const mission_worker = new MissionWorker(database);
export const missions = Router();
const base = "/:session_id/mission";
const project_for = (request: Request) => {
  const owner = current_account(request);
  if (!owner) throw new AppError(401,"Sign in to see this mission.");
  const session = request.params.session_id;
  if (typeof session !== "string" || !database().accounts.owns(owner.id,session)) throw new AppError(404,"Project unavailable.");
  return session;
};
const mission_id_for = (request: Request) => {
  const id = z.uuid().safeParse(request.params.mission_id);
  if (!id.success) throw new AppError(404,"Mission unavailable.");
  return id.data;
};
missions.get(base,(req,res) => {
  const session = project_for(req);
  const db = database();
  const m = db.missions.current(session);
  res.set("Cache-Control","private, no-store").json({ mission: m && mission_view(db,session,m) });
});
missions.get(base + "/:mission_id",(req,res) => {
  const session = project_for(req);
  const id = mission_id_for(req);
  const revision = req.query.revision === undefined ? null : Number(req.query.revision);
  if (revision !== null && (!Number.isSafeInteger(revision) || revision < 1)) throw new AppError(400,"Supply a valid mission revision.");
  const repo = database().missions;
  const m = revision === null ? repo.get(session,id) : repo.revision(session,id,revision);
  res.set("Cache-Control","private, no-store").json({ mission: mission_view(database(),session,m) });
});
missions.post(base + "/:mission_id/revise",(req,res) => {
  const session = project_for(req);
  const parsed = mission_revision_input.safeParse(req.body);
  if (!parsed.success) throw new AppError(400,"Review the contract fields and budget.");
  const { revision, contract } = parsed.data;
  const db = database();
  const id = mission_id_for(req);
  const old = db.missions.get(session,id);
  if (old.contract.contract_id !== contract.contract_id || revision !== contract.revision) throw new AppError(409,"Reopen the latest outcome contract.");
  db.sources.selected(session,contract.sources.files);
  if (!contract.sources.public_search && contract.sources.urls.length) throw new AppError(400,"Remove website addresses or enable public sources.");
  const mission = db.missions.atomic(() => {
    const revised = db.missions.revise(session,id,revision,contract);
    if (old.site_run_id) db.site_runs.stop(session,old.site_run_id);
    const studio = studio_context(db,session);
    if (old.proposal_id && studio.state.proposal?.proposal_id === old.proposal_id && studio.state.phase === "proposed") {
      db.studio.commit_state(session,studio.revision,{ ...studio.state, proposal: null, proposal_turn_id: undefined,
        proposal_heard: false, phase: "interview" },studio.snapshot?.prior_history ?? [],() => {});
    }
    return revised;
  });
  res.set("Cache-Control","private, no-store").json({ mission: mission_view(db,session,mission) });
});
const retry_input = mission_revision.extend({ retry_id: z.string().regex(/^[a-f0-9]{64}$/u) });
export const create_mission_retry_handler = (ensure_available = ensure_retry_provider): RequestHandler => (req,res) => {
  const session = project_for(req);
  const id = mission_id_for(req);
  const input = retry_input.safeParse(req.body);
  if (!input.success) throw new AppError(400,"Retry the step from the current mission.");
  const db = database();
  const m = retry_mission(db,session,id,input.data.revision,input.data.retry_id,ensure_available);
  res.set("Cache-Control","private, no-store").json({ mission: mission_view(db,session,m) });
};
missions.post(base + "/:mission_id/retry",create_mission_retry_handler());
missions.post(base + "/:mission_id/:action",(req,res) => {
  const session = project_for(req);
  const parsed = mission_revision.safeParse(req.body);
  if (!parsed.success) throw new AppError(400,"Include the revision of the plan you reviewed.");
  const db = database();
  const action = req.params.action;
  const id = mission_id_for(req);
  const revision = parsed.data.revision;
  if (action === "approve") {
    const mission = approve_mission(db,session,id,revision);
    res.set("Cache-Control","private, no-store").json({ mission: mission_view(db,session,mission) });
    return;
  }
  if (action !== "stop" && action !== "take-over") throw new AppError(404,"Unknown mission action.");
  const mission = halt_mission(db,session,id,revision,action);
  res.set("Cache-Control","private, no-store").json({ mission: mission_view(db,session,mission) });
});
