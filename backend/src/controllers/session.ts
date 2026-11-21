import { createHash, randomBytes } from "node:crypto";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { SessionStore } from "../repositories/session";
import { create_model_step } from "../services/ai-sdk";
import { configured_models } from "../services/model-config";
import { SessionRunner } from "../services/session-runner";

let store: SessionStore | undefined;
export const database = () => store ??= new SessionStore(process.env.AI_SESSION_DB ?? "./data/ai-sessions.sqlite");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const runs = new Map<string, AbortController>();
const input = z.object({ message: z.string().trim().min(1).max(8000), context: z.string().max(60000).default("") });

export function create_session(c: Context) {
  const session_id = crypto.randomUUID();
  const token = randomBytes(32).toString("base64url");
  database().add_session(session_id, hash(token));
  c.header("Cache-Control", "no-store");
  return c.json({ session_id, token }, 201);
}

export function session_for(c: Context) {
  const id = c.req.param("session_id");
  const token = c.req.header("Authorization")?.match(/^Bearer ([\w-]+)$/)?.[1];
  return id && token && database().authorized(id, hash(token)) ? id : null;
}

export async function start_run(c: Context) {
  const session = session_for(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const parsed = input.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return c.json({ error: "Invalid message or context" }, 400);
  const models = configured_models();
  if (!process.env.OPENAI_API_KEY || !models.length) return c.json({ error: "Configure OPENAI_API_KEY and OPENAI_TEXT_MODELS" }, 503);
  const db = database();
  const run_id = db.start(session, parsed.data.message, parsed.data.context);
  if (!run_id) return c.json({ error: "Session already has an active run" }, 409);
  const abort = new AbortController();
  runs.set(run_id, abort);
  const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(120000)]);
  const runner = new SessionRunner(session, db, create_model_step(models));
  void runner.execute(run_id, signal).catch(() => db.finish(run_id, { type: "failed", reason: "Session execution failed" }))
    .finally(() => runs.delete(run_id));
  return c.json({ run_id }, 202);
}

export function cancel_run(c: Context) {
  const session = session_for(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const id = c.req.param("run_id") ?? "";
  if (!database().get(session, id)) return c.json({ error: "Unknown run" }, 404);
  runs.get(id)?.abort();
  return c.body(null, 204);
}

export function run_events(c: Context) {
  const session = session_for(c);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const id = c.req.param("run_id") ?? "";
  const db = database();
  if (!db.get(session, id)) return c.json({ error: "Unknown run" }, 404);
  const after = Number(c.req.header("Last-Event-ID") ?? 0);
  if (!Number.isSafeInteger(after) || after < 0) return c.json({ error: "Invalid event cursor" }, 400);
  return streamSSE(c, async stream => {
    let cursor = after;
    while (!stream.aborted) {
      const rows = db.events(id, cursor);
      for (const row of rows) {
        await stream.writeSSE({ id: String(row.seq), data: row.event });
        cursor = row.seq;
      }
      if (rows.length) continue;
      if (db.get(session, id)?.status !== "running") return;
      await stream.sleep(150);
    }
  });
}
