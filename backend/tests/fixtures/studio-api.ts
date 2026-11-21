import { research_handlers } from "../../src/controllers/research";
import { create_studio_turn_handler } from "../../src/controllers/studio-turn";
import { api_error } from "../../src/middleware/api-error";
import { database } from "../../src/repositories/store";
import { create_interview_router } from "../../src/routes/interview";
import { chart_candidates, selected_chart } from "../../src/services/pitch-chart";
import type { TResearchProvider } from "../../src/types/research";
import { ResearchWorker } from "../../src/workers/research";

if (!process.argv[2] || !process.argv[3]) throw Error("Expected a temporary SQLite path and a loopback port");
process.env.AI_SESSION_DB = process.argv[2];
process.env.OPENAI_API_KEY = "";
process.env.CORS_ORIGIN = process.argv[4];
const { default: app, create_api } = await import("../../src/app");

const provider: TResearchProvider = {
  collect_step: async () => { throw new Error("This fixture permits files-only research"); },
  clarify: async scope => ({ summary: scope.messages.join(" "), question: null, public_queries: [] }),
  lookup: async () => { throw Error("This fixture permits files-only research"); },
  draft: async (_brief, evidence) => {
    await Bun.sleep(4000);
    const material = evidence.find(row => row.origin === "material");
    if (!material) throw Error("Expected the uploaded or pasted source");
    const support = [{ evidence_id: material.id, excerpt: material.passage }];
    const chart = selected_chart({ type: "line", candidate_ids: chart_candidates(evidence).map(candidate => candidate.id) }, evidence);
    const graph_xml = chart && "<graph>" + JSON.stringify({
      ...chart,
      data: chart.data.map(point => ({
        ...point, period: point.label,
        excerpt: evidence.find(row => row.id === point.evidence_id)?.passage.split("\n")
          .find(line => line.includes(point.label)) ?? "",
      })),
    }) + "</graph>";
    return {
      title: "Revenue review", gaps: [], graph_xml,
      sections: [{ heading: "Reported revenue", paragraphs: [{ prose: material.passage, support }] }],
    };
  },
  verify: async review => review.units.map(unit => ({ id: unit.id, decision: "supported" })),
};

const worker = new ResearchWorker(database, () => provider);
const turn = create_studio_turn_handler({
  ensure_research: () => {}, wake: job_id => worker.wake(job_id),
  agent: async ({ message, state, evidence }) => {
    const language = /[\u0900-\u097f]/u.test(message) ? "hi" : "en";
    if (state.phase === "researching") return { reply: language === "hi" ? "शोध जारी है।" : "Research is running.", language, actions: [] };
    if (/revenue/i.test(message)) return { reply: "I’ll review the reported revenue for the board and ask them to approve a pilot. Shall I start?",
      language, actions: [{ kind: "remember", goal: "Board revenue review", notes: [] },
        { kind: "propose_research", summary: "Review reported revenue for the board", queries: [], urls: state.urls ?? [] }] };
    if (evidence?.length && /what|read/i.test(message)) return { reply: "I found these details in your file.", language, actions: [],
      citations: evidence.slice(0, 2).map(item => ({ evidence_id: item.id, excerpt: item.passage.slice(0, 240) })) };
    return { reply: "What do you want to pitch?", language, actions: [] };
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
