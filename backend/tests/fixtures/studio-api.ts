import { research_handlers } from "../../src/controllers/research";
import { api_error } from "../../src/middleware/api-error";
import { database } from "../../src/repositories/store";
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

const fixture = create_api();
const handlers = research_handlers(() => provider);
fixture.post("/api/sessions/:session_id/research/brief", handlers.review);
fixture.post("/api/sessions/:session_id/research", handlers.build);
fixture.use(app);
fixture.use(api_error);
new ResearchWorker(database, () => provider).start();
fixture.listen(Number(process.argv[3]), "127.0.0.1");
