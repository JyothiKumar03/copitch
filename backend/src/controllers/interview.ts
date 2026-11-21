import type { Request, Response } from "express";
import { once } from "node:events";
import { z } from "zod";
import { AppError } from "../errors/app-error";
import { brief_history } from "../services/research-history";
import { database } from "../repositories/store";
import { interview_greeting, interview_workspace, max_spoken_length, progress_reply, spoken_prompt } from "../services/interview";
import { call_voice_worker, max_recording_bytes, recording_type } from "../services/interview-voice";
import { initial_studio_context } from "../services/studio-turn";

export const interview_handlers = (fetch_worker: (url:string,options:RequestInit) => Promise<globalThis.Response> = fetch) => ({
  connect: async (req: Request, res: Response) => {
    if (!Buffer.isBuffer(req.body) || !req.body.toString("utf8").startsWith("v=0")) throw new AppError(400, "Invalid audio offer");
    const language = database().studio.language_preference(res.locals.host_session_id);
    const reply = await call_voice_worker("connect", "application/sdp", req.body.toString("utf8"), fetch_worker, language);
    if (reply.kind !== "sdp") throw new AppError(502, "Unexpected voice answer");
    res.type("application/sdp").send(reply.sdp);
  },

  transcribe: async (req: Request, res: Response) => {
    const content_type = req.get("Content-Type") ?? "";
    if (!/^multipart\/form-data\s*;/i.test(content_type)) throw new AppError(415,"Send a multipart audio field");
    let form: Awaited<ReturnType<globalThis.Response["formData"]>>;
    try {
      form = await new globalThis.Response(req.body,{headers:{"Content-Type":content_type}}).formData();
    } catch {
      throw new AppError(400,"Invalid multipart recording");
    }
    const values = form.getAll("audio");
    const audio = values[0];
    if (values.length !== 1 || !(audio instanceof Blob) || !audio.size) throw new AppError(400,"Supply one nonempty audio recording");
    if (audio.size > max_recording_bytes) throw new AppError(413,"Recording exceeds 8 MiB");
    const mime = recording_type(audio.type);
    if (!mime) throw new AppError(415,"Unsupported recording format");
    const language = database().studio.language_preference(res.locals.host_session_id);
    const reply = await call_voice_worker("transcribe",mime,audio,fetch_worker,language);
    if (reply.kind !== "text") throw new AppError(502,"Unexpected interview voice response");
    res.json({text:reply.text});
  },

  progress: (req: Request, res: Response) => {
    const input = z.object({ job_id: z.string().uuid(), turn_id: z.string().uuid(), message: z.string().trim().min(1).max(6000), language: z.enum(["hi", "en"]) }).safeParse(req.body);
    if (!input.success) throw new AppError(400, "Invalid progress request");
    const job = database().research_jobs.get(res.locals.host_session_id, input.data.job_id);
    if (!job) throw new AppError(404, "Unknown research job");
    const session = res.locals.host_session_id;
    const brief = database().current_brief(session);
    if (!brief || job.brief_id !== brief.brief_id) throw new AppError(409, "Research scope changed");
    const answer = database().research_jobs.record_progress(session, job.job_id, input.data.turn_id,
      brief_history(brief).length, input.data.message, progress_reply(job, input.data.language));
    res.json({ job_id: job.job_id, brief_id: job.brief_id, text: answer });
  },

  speech: async (req: Request,res: Response) => {
    let body: unknown;
    try { body = JSON.parse(req.body.toString("utf8")); } catch { throw new AppError(400,"Invalid JSON"); }
    const input = z.strictObject({text:z.string().min(1).max(max_spoken_length), progress_turn_id:z.string().uuid().optional()}).safeParse(body);
    if (!input.success) throw new AppError(400,"Supply an interview prompt up to 1600 characters");
    const session = res.locals.host_session_id as string;
    const brief = database().current_brief(session);
    const greeting = input.data.text === interview_greeting;
    const turn_id = input.data.progress_turn_id;
    const progress = turn_id && (database().research_jobs.progress_answer(session, turn_id) === input.data.text ||
      database().studio.reply(session, turn_id) === input.data.text);
    if (!progress && !greeting && (!brief || spoken_prompt(brief) !== input.data.text)) throw new AppError(409,"Prompt no longer matches the current brief");
    const language = (turn_id ? database().studio.reply_language(session, turn_id) : undefined) ?? database().studio.language_preference(session);
    const client = new AbortController();
    const cancel = () => client.abort();
    res.once("close", cancel);
    try {
      const reply = await call_voice_worker("speech", "application/json", JSON.stringify({ text: input.data.text }), fetch_worker, language, client.signal);
      if (reply.kind !== "audio") throw new AppError(502, "Unexpected interview voice response");
      const reader = reply.stream.getReader();
      let size = 0;
      try {
        res.type("audio/mpeg").set("X-Accel-Buffering", "no");
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value.length) continue;
          size += value.length;
          if (size > max_recording_bytes) throw new AppError(502, "Invalid speech output");
          if (!progress && !greeting && database().current_brief(session)?.brief_id !== brief?.brief_id) {
            throw new AppError(409, "Brief changed during speech generation");
          }
          if (!res.headersSent && turn_id) database().studio.offer_question(session, turn_id);
          if (!res.write(value)) await once(res, "drain", { signal: client.signal });
        }
        if (!size) throw new AppError(502, "Empty speech output");
        res.end();
      } finally {
        await reader.cancel().catch(() => {});
      }
    } catch (error) {
      if (!client.signal.aborted) {
        if (res.headersSent) res.destroy();
        else { res.removeHeader("Content-Type"); throw error; }
      }
    } finally {
      res.off("close", cancel);
      cancel();
    }
  },

  start: (_req: Request, res: Response) => {
    const session = res.locals.host_session_id as string;
    const db = database();
    if (!db.current_brief(session)) db.studio.seed(session, initial_studio_context(), [{ role: "assistant", text: interview_greeting }]);
    res.json({ greeting: interview_greeting, workspace: interview_workspace(session, db) });
  },

  workspace: (_req: Request, res: Response) => {
    res.json(interview_workspace(res.locals.host_session_id));
  },
});
