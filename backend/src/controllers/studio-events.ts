import type { RequestHandler } from "express";
import { AppError } from "../errors/app-error";
import { session_for } from "../middleware/host-session";
import { database } from "../repositories/store";
import { subscribe_studio } from "../services/studio-events";

export const studio_events: RequestHandler = (req, res) => {
  const session = session_for(req);
  if (!session) throw new AppError(401, "Sign in to this project.");
  const requested = req.get("Last-Event-ID");
  if (requested !== undefined && (!/^\d+$/.test(requested) || !Number.isSafeInteger(Number(requested)))) {
    throw new AppError(400, "Invalid project event cursor.");
  }
  const updates = database().updates;
  const latest = updates.latest(session);
  let cursor = requested === undefined ? latest : Math.min(Number(requested), latest);
  let ready = false;
  let blocked = false;
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "private, no-store, no-transform", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  const drain = () => { blocked = false; flush(); };
  const write = (frame: string) => {
    blocked = !res.write(frame);
    if (blocked) res.once("drain", drain);
  };
  const flush = () => {
    if (blocked || res.destroyed || res.writableEnded) return;
    if (session_for(req) !== session) { res.end(); return; }
    const rows = updates.after(session, cursor);
    for (const { seq, kind, resource_id } of rows) {
      cursor = seq;
      write(`id: ${seq}\nevent: studio\ndata: ${JSON.stringify({ kind, resource_id })}\n\n`);
      if (blocked) return;
    }
    if (rows.length === 128) { setImmediate(flush); return; }
    if (!ready) {
      ready = true;
      write(`id: ${cursor}\nevent: ready\ndata: {}\n\n`);
    }
  };
  const unsubscribe = subscribe_studio(session, flush);
  const heartbeat = setInterval(() => {
    flush();
    if (!blocked && !res.destroyed && !res.writableEnded) write(": heartbeat\n\n");
  }, 20_000);
  res.once("close", () => {
    clearInterval(heartbeat);
    res.off("drain", drain);
    unsubscribe();
  });
  flush();
};
