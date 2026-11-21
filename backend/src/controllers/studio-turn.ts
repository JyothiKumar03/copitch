import type { Request, Response } from "express";
import { AppError } from "../errors/app-error";
import { database } from "../repositories/store";
import { interview_workspace } from "../services/interview";
import { configured_models_for } from "../services/model-config";
import { studio_agent } from "../services/studio-agent";
import { run_studio_turn, update_studio_scope } from "../services/studio-turn";
import type { TStudioTurnServices } from "../services/studio-turn";
import { studio_scope_input, studio_turn_input } from "../types/studio-turn";
import { flush_voice_exchange } from "./live-call";
import { research_worker } from "./research";

const ensure_research = () => {
  if (!process.env.OPENAI_API_KEY || !configured_models_for("research").length) throw new AppError(503, "Research is unavailable until a provider is configured");
};

export const create_studio_turn_handler = (services: TStudioTurnServices) => async (req: Request, res: Response) => {
  const input = studio_turn_input.safeParse(req.body);
  if (!input.success) throw new AppError(400, "Invalid studio turn");
  const session = res.locals.host_session_id as string;
  const db = database();
  flush_voice_exchange(session);
  const saved = await run_studio_turn(db, session, input.data, services, false);
  const { turn_id, phase, text, language, proposal, activity } = saved;
  res.json({ turn_id, phase, text, language, proposal, activity, workspace: interview_workspace(session, db) });
};

export const studio_turn_handler = create_studio_turn_handler({
  agent: studio_agent, ensure_research, wake: job_id => research_worker.wake(job_id),
});

export const studio_scope_handler = (req: Request, res: Response) => {
  const input = studio_scope_input.safeParse(req.body);
  if (!input.success) throw new AppError(400, "Invalid studio source selection");
  const session = res.locals.host_session_id as string;
  const db = database();
  update_studio_scope(db, session, input.data);
  res.json({ workspace: interview_workspace(session, db) });
};
