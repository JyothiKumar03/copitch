import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import type { Request, Response } from "express";
import { z } from "zod";
import { AppError } from "../errors/app-error";
import { session_for } from "../middleware/host-session";
import { database } from "../repositories/store";
import { create_model_step } from "../services/ai-sdk";
import { configured_models_for } from "../services/model-config";
import { SessionRunner } from "../services/session-runner";

const runs = new Map<string, AbortController>();
const input = z.object({ message: z.string().trim().min(1).max(8000), context: z.string().max(60000).default("") });

export const create_session = (_req: Request, res: Response) => {
  const session_id = crypto.randomUUID();
  const token = randomBytes(32).toString("base64url");
  database().add_session(session_id, createHash("sha256").update(token).digest("hex"));
  res.set("Cache-Control","no-store").status(201).json({ session_id, token });
};

export const start_run = (req: Request, res: Response) => {
  const session = session_for(req);
  if (!session) throw new AppError(401,"Unauthorized");
  const parsed = input.safeParse(req.body);
  if (!parsed.success) throw new AppError(400,"Invalid message or context");
  const models = configured_models_for("chat");
  if (!process.env.OPENAI_API_KEY || !models.length) throw new AppError(503,"Configure OPENAI_API_KEY and OPENAI_TEXT_MODELS");
  const db = database();
  const run_id = db.start(session, parsed.data.message, parsed.data.context);
  if (!run_id) throw new AppError(409,"Session already has an active run");
  const abort = new AbortController();
  runs.set(run_id, abort);
  const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(120000)]);
  const runner = new SessionRunner(session, db, create_model_step(models));
  void runner.execute(run_id, signal).catch(() => db.finish(run_id, { type: "failed", reason: "Session execution failed" }))
    .finally(() => runs.delete(run_id));
  res.status(202).json({ run_id });
};

export const cancel_run = (req: Request, res: Response) => {
  const session = session_for(req);
  if (!session) throw new AppError(401,"Unauthorized");
  const id = req.params.run_id;
  if (typeof id !== "string" || !database().get(session,id)) throw new AppError(404,"Unknown run");
  runs.get(id)?.abort();
  res.status(204).end();
};

export const run_events = async (req: Request, res: Response) => {
  const session = session_for(req);
  if (!session) throw new AppError(401,"Unauthorized");
  const id = req.params.run_id;
  const db = database();
  if (typeof id !== "string" || !db.get(session,id)) throw new AppError(404,"Unknown run");
  let cursor = Number(req.get("Last-Event-ID") ?? 0);
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new AppError(400,"Invalid event cursor");
  const closed = new AbortController();
  const disconnect = () => closed.abort();
  res.once("close",disconnect);
  res.set({ "Content-Type":"text/event-stream; charset=utf-8", "Cache-Control":"no-cache",
    Connection:"keep-alive", "X-Accel-Buffering":"no" });
  res.flushHeaders();
  try {
    while (!closed.signal.aborted) {
      const rows = db.events(id,cursor);
      for (const row of rows) {
        if (!res.write(`id: ${row.seq}\ndata: ${row.event}\n\n`)) {
          await once(res,"drain",{ signal:closed.signal });
        }
        cursor = row.seq;
      }
      if (rows.length) continue;
      if (db.get(session,id)?.status !== "running") break;
      await delay(150,undefined,{ signal:closed.signal });
    }
  } catch (error) {
    if (!closed.signal.aborted) throw error;
  } finally {
    res.off("close",disconnect);
    if (!res.destroyed) res.end();
  }
};
