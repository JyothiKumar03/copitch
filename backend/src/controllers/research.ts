import { bind_job_trace } from "../middleware/trace";
import type { Response } from "express";
import type { TApiRequest } from "../types/http";
import { AppError } from "../errors/app-error";
import { z } from "zod";
import { database } from "../repositories/store";
import { session_for } from "../middleware/host-session";
import { configured_models_for } from "../services/model-config";
import { ResearchWorker } from "../workers/research";
import { setTimeout as delay } from "node:timers/promises";
import { source_summary } from "../repositories/source";
import { public_url, research_report } from "../services/research";
import { assistant_reply, brief_history } from "../services/research-history";
import { interview_brief } from "../services/interview";
import { research_provider } from "../services/research-provider";
import type { TResearchBrief, TResearchProvider } from "../types/research";

const brief_input = z.object({
  message: z.string().trim().min(1).max(6000), brief_id: z.string().uuid().optional(),
  source_policy: z.enum(["files_only","public_search"]), materials: z.string().max(30000).optional(),
  source_ids: z.array(z.string().uuid()).max(6).optional(),
  urls: z.array(z.string().max(2048).refine(value => Boolean(public_url(value)))).max(8).optional(),
});
const build_input = z.object({
  brief_id: z.string().uuid(), confirmed: z.literal(true), retry: z.boolean().optional(),
  approval_text: z.string().trim().min(1).max(6000).optional(),
});

const configured_provider = (purpose: "interview" | "research") => {
  const models = configured_models_for(purpose);
  const [model] = models;
  if (!model || !process.env.OPENAI_API_KEY) throw new AppError(503, "Configure OPENAI_API_KEY and OPENAI_TEXT_MODELS");
  return research_provider(model, undefined, purpose === "research" ? models : []);
};

export const research_worker = new ResearchWorker(database, () => configured_provider("research"));

export const research_handlers = (get_provider: (purpose: "interview" | "research") => TResearchProvider = configured_provider) => {
  const worker = get_provider === configured_provider ? research_worker : new ResearchWorker(database, () => get_provider("research"));
  return {
    review: async (req: TApiRequest, res: Response) => {
      const session = session_for(req);
      if (!session) return res.status(401).json({ error: "Unauthorized" });
      const parsed = brief_input.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid brief, materials, or public URL" });
      const input = parsed.data;
      const db = database();
      const previous = db.current_brief(session);
      if (input.brief_id && input.brief_id !== previous?.brief_id) return res.status(409).json({ error: "Brief revision is stale" });
      const prior = input.brief_id ? previous : undefined;
      const messages = [...(prior?.messages ?? []), input.message];
      if (messages.length > 12 || messages.join("").length > 24000) return res.status(400).json({ error: "Brief exceeds intake budget" });
      const urls = [...new Set((input.urls ?? prior?.urls ?? []).map(value => public_url(value)!))];
      const materials = input.materials ?? prior?.materials ?? "";
      const ids = input.source_ids ?? prior?.sources?.map(source => source.source_id) ?? [];
      const sources = db.sources.selected(session, [...new Set(ids)]).map(source_summary);
      const provider = get_provider("interview");
      const history = prior ? brief_history(prior) : [];
      const scope = { messages, history: [...history, { role: "host" as const, text: input.message }], previous_question: prior?.question, urls, source_policy: input.source_policy };
      const review = await provider.clarify(scope, AbortSignal.timeout(40000));
      if (!review.summary.trim()) return res.status(502).json({ error: "Model returned an empty brief" });
      const brief: TResearchBrief = { ...scope, materials, sources, summary: review.summary.trim(),
        history: [...scope.history, { role: "assistant", text: assistant_reply(review) }],
        question: review.question?.trim() || null, brief_id: crypto.randomUUID(),
        public_queries: input.source_policy === "public_search" ? [...new Set(review.public_queries.map(query => query.trim()).filter(Boolean))].slice(0,3) : [],
      };
      if (!db.replace_brief(session, previous?.brief_id, brief)) return res.status(409).json({ error: "Brief changed during review" });
      return res.set("Cache-Control", "private, no-store").json(interview_brief(brief, session));
    },
    build: async (req: TApiRequest, res: Response) => {
      const session = session_for(req);
      if (!session) return res.status(401).json({ error: "Unauthorized" });
      const input = build_input.safeParse(req.body);
      if (!input.success) return res.status(400).json({ error: "Confirm the reviewed brief before research" });
      const db = database();
      const brief = db.current_brief(session);
      if (!brief || brief.brief_id !== input.data.brief_id) return res.status(409).json({ error: "Brief revision is stale" });
      if (brief.question) return res.status(409).json({ error: "Answer the open clarification before confirming research" });
    if (brief.studio_version === 2 && !db.research_jobs.for_brief(session, brief.brief_id)) {
      return res.status(409).json({ error: "Approve the current studio proposal before starting research" });
    }
      const jobs = db.research_jobs;
      // Verify configuration before accepting new work. Already saved reports remain accessible offline.
      if (!db.research_by_brief(session,brief.brief_id)) get_provider("research");
      const question = input.data.approval_text ?? "Start researching.";
      const answer = /[\u0900-\u097f]/u.test(question + brief.summary)
        ? "मैं आपके स्वीकृत दायरे पर शोध कर रहा हूँ।" : "I’m researching the scope you approved.";
      let job = jobs.enqueue(session, brief.brief_id, input.data.retry, {
        after_turn: brief_history(brief).length, question, answer,
      });
      bind_job_trace(res, job.job_id);
      worker.wake(job.job_id);
      if (req.get("Prefer")?.split(",").some(value => value.trim() === "respond-async")) {
        return res.status(job.status === "completed" ? 200 : 202).json({
          ...job, history: interview_brief(brief, session).history,
        });
      }
      // Keep the original response contract for existing clients. Disconnection ends only this wait.
      while (job.status === "running" || job.status === "queued") {
        if (res.destroyed) return;
        await delay(100);
        job = jobs.get(session,job.job_id)!;
        if (job.status === "queued" || job.status === "running") worker.wake(job.job_id);
      }
      if (job.result) return res.json(job.result);
      return res.status(job.status === "superseded" ? 409 : 503).json({ job_id: job.job_id, error: job.error ?? "Research failed" });
    },
    job: (req: TApiRequest, res: Response) => {
      const session = session_for(req);
      if (!session) return res.status(401).json({ error:"Unauthorized" });
      const job = database().research_jobs.get(session,req.params.job_id);
      if (!job) return res.status(404).json({ error:"Unknown research job" });
      bind_job_trace(res, job.job_id);
      res.set("Cache-Control","private, no-store");
      return res.json(job);
    },
    download: (req: TApiRequest, res: Response) => {
      const session = session_for(req);
      if (!session) return res.status(401).json({ error: "Unauthorized" });
      const bundle = database().research_by_id(session, req.params.research_id);
      if (!bundle) return res.status(404).json({ error: "Unknown research artifact" });
      return res.set({ "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": 'attachment; filename="presentation.md"', "Cache-Control": "private, no-store" }).send(bundle.markdown ?? research_report(bundle));
    },
  };
};
