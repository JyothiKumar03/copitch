import { research_handlers } from "../../src/controllers/research";
import { create_studio_turn_handler } from "../../src/controllers/studio-turn";
import { api_error } from "../../src/middleware/api-error";
import { database } from "../../src/repositories/store";
import { create_interview_router } from "../../src/routes/interview";
import { chart_candidates } from "../../src/services/pitch-chart";
import type { TResearchProvider } from "../../src/types/research";
import { ResearchWorker } from "../../src/workers/research";

if (!process.argv[2] || !process.argv[3]) throw Error("Expected a temporary SQLite path and a loopback port");
process.env.AI_SESSION_DB = process.argv[2];
process.env.OPENAI_API_KEY = "";
process.env.CORS_ORIGIN = process.argv[4];
const { default: app, create_api } = await import("../../src/app");

const provider: TResearchProvider = {
  clarify: async scope => ({ summary: scope.messages.join(" "), question: null, public_queries: [] }),
  lookup: async () => { throw Error("This fixture permits files-only research"); },
  draft: async (_brief, evidence) => {
    await Bun.sleep(4000);
    const material = evidence.find(row => row.origin === "material");
    if (!material) throw Error("Expected the uploaded or pasted source");
    const support = [{ evidence_id: material.id, excerpt: material.passage }];
    return {
      title: "Revenue review", gaps: [],
      pitch_chart: { type: "line", candidate_ids: chart_candidates(evidence).map(candidate => candidate.id) },
      sections: [{ heading: "Reported revenue", paragraphs: [{ prose: material.passage, support }] }],
    };
  },
  verify: async review => review.units.map(unit => ({ id: unit.id, decision: "supported" })),
};

const worker = new ResearchWorker(database, () => provider);
const turn = create_studio_turn_handler({
  ensure_research: () => {}, wake: job_id => worker.wake(job_id),
  provider: {
    propose: async ({message}) => ({
      intent: /revenue/i.test(message) ? "brief" : "unsupported", language: "en",
      subject: /revenue/i.exec(message)?.[0] ?? null, audience: /board/i.exec(message)?.[0] ?? null,
      decision: /approve the pilot/i.exec(message)?.[0] ?? null, fact: null, instruction: null, source_phrase: null, source_url: null,
    }),
    excerpts: async (_message, evidence) => ({ citations: evidence.slice(0, 2).map(item => ({ evidence_id: item.id, excerpt: item.passage.slice(0, 240) })) }),
  },
});
const fixture = create_api(create_interview_router(fetch, turn));
const handlers = research_handlers(() => provider);
fixture.post("/api/sessions/:session_id/research/brief", handlers.review);
fixture.post("/api/sessions/:session_id/research", handlers.build);
fixture.use(app);
fixture.use(api_error);
worker.start();
fixture.listen(Number(process.argv[3]), "127.0.0.1");
