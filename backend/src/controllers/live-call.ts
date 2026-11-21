import type { Request, Response } from "express";
import { z } from "zod";
import { AppError } from "../errors/app-error";
import { database } from "../repositories/store";
import { call_voice_worker } from "../services/interview-voice";
import { create_live_interviewer } from "../services/live-interviewer";
import { live_session_setup } from "../services/live-session";
import { configured_models_for } from "../services/model-config";
import { apply_voice_action, record_voice_exchange } from "../services/studio-turn";
import { research_worker } from "./research";

type TActiveCall = { lease: string; finish: () => void; flush?: () => void };
const calls = new Map<string, TActiveCall>();
const provider = "https://api.openai.com/v1/live/sessions/";
const control = z.strictObject({ kind: z.literal("close"), lease: z.uuid() });

// Save the voice exchange in progress before a typed turn or button changes the conversation, so order follows real time.
export const flush_voice_exchange = (session: string) => calls.get(session)?.flush?.();

export const live_control = (req: Request, res: Response) => {
  const input = control.safeParse(req.body);
  if (!input.success) throw new AppError(400, "Invalid voice control");
  const active = calls.get(res.locals.host_session_id as string);
  if (!active || active.lease !== input.data.lease) throw new AppError(409, "The voice conversation has ended");
  active.finish();
  res.sendStatus(204);
};

export const connect_live = (fetch_worker: typeof fetch | ((url: string, options: RequestInit) => Promise<globalThis.Response>) = fetch) => async (req: Request, res: Response) => {
  const session = res.locals.host_session_id as string;
  if (!Buffer.isBuffer(req.body) || !req.body.toString("utf8").startsWith("v=0")) throw new AppError(400, "Invalid audio offer");
  if (!process.env.OPENAI_API_KEY) throw new AppError(503, "Voice provider is unavailable");
  if (calls.has(session) || calls.size >= 4) throw new AppError(429, "A voice conversation is already active. End it before reconnecting.");
  const lease = crypto.randomUUID();
  let socket: WebSocket | undefined;
  let live_id = "";
  let idle: ReturnType<typeof setTimeout> | undefined;
  const end = () => {
    if (calls.get(session)?.lease !== lease) return;
    calls.delete(session);
    clearTimeout(lifetime); clearTimeout(idle);
    socket?.close();
    if (live_id) void fetch(provider + encodeURIComponent(live_id) + "/hangup", {
      method: "POST", headers: { Authorization: "Bearer " + process.env.OPENAI_API_KEY }, signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  };
  const lifetime = setTimeout(end, 15 * 60_000);
  const reset_idle = () => { clearTimeout(idle); idle = setTimeout(end, 120_000); };
  const active: TActiveCall = { lease, finish: end };
  calls.set(session, active);
  const abort = new AbortController();
  res.once("close", () => { if (!res.writableEnded) { abort.abort(); end(); } });
  try {
    const db = database();
    const offer = JSON.stringify({ sdp: req.body.toString("utf8"), session: live_session_setup(db, session) });
    const reply = await call_voice_worker("connect", "application/json", offer, fetch_worker, undefined, abort.signal);
    if (reply.kind !== "sdp" || !reply.session_id) throw new AppError(502, "Invalid voice session");
    live_id = reply.session_id;
    const ws = new WebSocket("wss://api.openai.com/v1/live/sessions/" + encodeURIComponent(live_id) + "/attach", {
      headers: { Authorization: "Bearer " + process.env.OPENAI_API_KEY },
    } as unknown as string[]);
    socket = ws;
    const services = {
      ensure_research: () => { if (!configured_models_for("research").length) throw new AppError(503, "Research is unavailable"); },
      wake: (job: string) => research_worker.wake(job),
    };
    const interviewer = create_live_interviewer({
      send: event => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event)); },
      close: end,
      record: exchange => { record_voice_exchange(db, session, exchange); },
      act: (message, action) => apply_voice_action(db, session, message, action, services),
      heard: (proposal, turn) => { db.studio.hear_proposal(session, proposal, turn); },
    });
    active.flush = interviewer.flush;
    ws.onmessage = ({ data }) => {
      if (typeof data !== "string" || data.length > 200000 || calls.get(session)?.lease !== lease) return;
      try {
        const event = JSON.parse(data);
        if (event.type === "session.input_transcript.delta" || event.type === "session.output_transcript.delta") reset_idle();
        else if (event.type === "error" && process.env.TRACE_LOGS === "1") {
          console.log(JSON.stringify({ operation: "live.sideband_event", type: "error" }));
        }
        void interviewer.receive(event).catch(end);
      } catch { /* Ignore malformed provider frames. */ }
    };
    await new Promise<void>((resolve, reject) => {
      const fail = () => { clearTimeout(timer); reject(new AppError(502, "Voice control connection failed")); };
      const timer = setTimeout(fail, 8000);
      ws.onopen = () => { clearTimeout(timer); resolve(); };
      ws.onerror = fail; ws.onclose = fail;
    });
    ws.onclose = () => { interviewer.close(); end(); };
    ws.onerror = end;
    if (abort.signal.aborted) { end(); return; }
    reset_idle();
    res.set("X-Voice-Lease", lease).set("Access-Control-Expose-Headers", "X-Voice-Lease").type("application/sdp").send(reply.sdp);
  } catch (error) { end(); throw error; }
};
