import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { database, session_for } from "./session";
import { configured_models } from "../services/model-config";
import { build_research, public_url } from "../services/research";
import { research_provider } from "../services/research-provider";
import type { TResearchBrief, TResearchBundle, TResearchProvider } from "../types/research";

const brief_input = z.object({
  message: z.string().trim().min(1).max(6000), brief_id: z.string().uuid().optional(),
  source_policy: z.enum(["files_only","public_search"]), materials: z.string().max(30000).optional(),
  urls: z.array(z.string().max(2048).refine(value => Boolean(public_url(value)))).max(8).optional(),
});
const build_input = z.object({ brief_id: z.string().uuid(), confirmed: z.literal(true) });
const builds = new Map<string, Promise<TResearchBundle>>();

function configured_provider() {
  const [model] = configured_models();
  if (!model || !process.env.OPENAI_API_KEY) throw new HTTPException(503, { message: "Configure OPENAI_API_KEY and OPENAI_TEXT_MODELS" });
  return research_provider(model);
}

export function research_handlers(get_provider: () => TResearchProvider = configured_provider) {
  return {
    async review(c: Context) {
      const session = session_for(c);
      if (!session) return c.json({ error: "Unauthorized" }, 401);
      const parsed = brief_input.safeParse(await c.req.json().catch(() => undefined));
      if (!parsed.success) return c.json({ error: "Invalid brief, materials, or public URL" }, 400);
      const input = parsed.data;
      const db = database();
      const previous = db.current_brief(session);
      if (input.brief_id && input.brief_id !== previous?.brief_id) return c.json({ error: "Brief revision is stale" }, 409);
      const prior = input.brief_id ? previous : undefined;
      const messages = [...(prior?.messages ?? []), input.message];
      if (messages.length > 12 || messages.join("").length > 24000) return c.json({ error: "Brief exceeds intake budget" }, 400);
      const urls = [...new Set((input.urls ?? prior?.urls ?? []).map(value => public_url(value)!))];
      const materials = input.materials ?? prior?.materials ?? "";
      const provider = get_provider();
      const scope = { messages, previous_question: prior?.question, urls, source_policy: input.source_policy };
      const review = await provider.clarify(scope, AbortSignal.timeout(40000));
      if (!review.summary.trim()) return c.json({ error: "Model returned an empty brief" }, 502);
      const brief: TResearchBrief = { ...scope, materials, summary: review.summary.trim(),
        question: review.question?.trim() || null, brief_id: crypto.randomUUID(),
        public_queries: input.source_policy === "public_search" ? [...new Set(review.public_queries.map(query => query.trim()).filter(Boolean))].slice(0,3) : [],
      };
      if (!db.replace_brief(session, previous?.brief_id, brief)) return c.json({ error: "Brief changed during review" }, 409);
      return c.json({ brief_id: brief.brief_id, summary: brief.summary, question: brief.question, public_queries: brief.public_queries });
    },
    async build(c: Context) {
      const session = session_for(c);
      if (!session) return c.json({ error: "Unauthorized" }, 401);
      const input = build_input.safeParse(await c.req.json().catch(() => undefined));
      if (!input.success) return c.json({ error: "Confirm the reviewed brief before research" }, 400);
      const db = database();
      const brief = db.current_brief(session);
      if (!brief || brief.brief_id !== input.data.brief_id) return c.json({ error: "Brief revision is stale" }, 409);
      if (brief.question) return c.json({ error: "Answer the open clarification before confirming research" }, 409);
      const cached = db.research_by_brief(session, brief.brief_id);
      let bundle = cached;
      if (!bundle) {
        let pending = builds.get(brief.brief_id);
        if (!pending) {
          const provider = get_provider();
          const check_current = () => {
            if (db.current_brief(session)?.brief_id !== brief.brief_id) throw new HTTPException(409, { message: "Research scope changed" });
          };
          pending = build_research(brief, provider, AbortSignal.timeout(90000), check_current).then(result => {
            if (!db.save_research(session, result)) throw new HTTPException(409, { message: "Research scope changed" });
            return result;
          }).finally(() => builds.delete(brief.brief_id));
          builds.set(brief.brief_id, pending);
        }
        bundle = await pending;
      }
      return c.json({ research_id: bundle.research_id, markdown: bundle.markdown, gaps: bundle.gaps });
    },
    download(c: Context) {
      const session = session_for(c);
      if (!session) return c.json({ error: "Unauthorized" }, 401);
      const bundle = database().research_by_id(session, c.req.param("research_id") ?? "");
      if (!bundle) return c.json({ error: "Unknown research artifact" }, 404);
      return new Response(bundle.markdown, { headers: { "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": 'attachment; filename="presentation.md"', "Cache-Control": "private, no-store" } });
    },
  };
}
