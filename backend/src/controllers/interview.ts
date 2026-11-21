import type { Request, Response } from "express";
import { z } from "zod";
import { AppError } from "../errors/app-error";
import { brief_history } from "../services/research-history";
import { database } from "../repositories/store";
import { interview_greeting, interview_workspace, progress_reply } from "../services/interview";
import { call_voice_worker, max_recording_bytes, recording_type } from "../services/interview-voice";
import { initial_studio_context } from "../services/studio-turn";

export const interview_handlers = (fetch_worker: (url:string,options:RequestInit) => Promise<globalThis.Response> = fetch) => ({
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
