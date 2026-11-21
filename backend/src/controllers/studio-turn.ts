import type { Request, Response } from "express";
import { z } from "zod";
import { AppError } from "../errors/app-error";
import { database } from "../repositories/store";
import { interview_workspace } from "../services/interview";
import { configured_models_for } from "../services/model-config";
import { studio_intent_provider } from "../services/studio-intent";
import { run_studio_turn } from "../services/studio-turn";
import type { TStudioTurnServices } from "../services/studio-turn";
import { studio_turn_input } from "../types/studio-turn";
import { research_worker } from "./research";

const ensure_research = () => {
  if (!process.env.OPENAI_API_KEY || !configured_models_for("research").length) throw new AppError(503, "Research is unavailable until a provider is configured");
};

export const create_studio_turn_handler = (services: TStudioTurnServices) => async (req: Request, res: Response) => {
  const input = studio_turn_input.safeParse(req.body);
  if (!input.success) throw new AppError(400, "Invalid studio turn");
  const session = res.locals.host_session_id as string;
  const db = database();
  const saved = await run_studio_turn(db, session, input.data, services);
  const { turn_id, intent, text, language, activity } = saved;
  res.json({ turn_id, intent, text, language, activity, workspace: interview_workspace(session, db) });
};

export const studio_turn_handler = create_studio_turn_handler({
  provider: studio_intent_provider, ensure_research, wake: job_id => research_worker.wake(job_id),
});

const heard_input = z.strictObject({ request_id: z.uuid(), turn_id: z.uuid() });

export const studio_heard_handler = (req: Request, res: Response) => {
  const input = heard_input.safeParse(req.body);
  if (!input.success) throw new AppError(400, "Invalid question playback acknowledgement");
  database().studio.acknowledge_question(res.locals.host_session_id, input.data.request_id, input.data.turn_id);
  res.sendStatus(204);
};
