import { SessionStore } from "../../backend/src/repositories/session";
import { configured_models_for } from "../../backend/src/services/model-config";
import { research_provider } from "../../backend/src/services/research-provider";
import { ResearchWorker } from "../../backend/src/workers/research";
import type { TResearchBrief } from "../../backend/src/types/research";

const [model] = configured_models_for("research");
if (!model || !process.env.OPENAI_API_KEY) throw new Error("Configure the existing research provider before running this eval.");

const cases = [{
  name: "personal_introduction",
  summary: "Introduce the speaker to their new operations teammates. Explain how they approach onboarding. Close with a takeaway. The team does not need to decide or do anything.",
  source_policy: "files_only",
  urls: [],
  public_queries: [],
  studio_notes: [
    "I lead customer onboarding for small businesses.",
    "I built a multilingual setup guide after customers said the previous instructions were unclear.",
    "The team documented 24 completed setups in week three. We do not know whether the guide caused the increase.",
  ],
  expected: "completed",
}, {
  name: "no_evidence_from_scope",
  summary: "Introduce the speaker to their team.",
  source_policy: "files_only",
  urls: [],
  public_queries: [],
  studio_notes: [],
  expected: "needs_input",
}] as const;

const db = new SessionStore(":memory:");
const worker = new ResearchWorker(() => db, () => research_provider(model));

for (const scenario of cases) {
  const { name, expected, ...input } = scenario;
  const session = crypto.randomUUID();
  const brief: TResearchBrief = {
    ...input, brief_id: crypto.randomUUID(), studio_version: 2, question: null,
    urls: [...input.urls], public_queries: [...input.public_queries], studio_notes: [...input.studio_notes],
    materials: "", messages: ["Could you make a pitch about me?"],
  };
  db.replace_brief(session, undefined, brief);
  const job = db.research_jobs.enqueue(session, brief.brief_id);
  await worker.tick(job.job_id);
  const outcome = db.research_jobs.get(session, job.job_id);
  const artifact = db.research_by_brief(session, brief.brief_id);
  const markdown = artifact?.context_markdown ?? "";
  const verified_context = artifact?.grounding?.mode === "verified" && markdown.includes("24") &&
    !/^##\s+Talk track/mu.test(markdown) && !/\[\^H\d+\]/u.test(markdown) && !outcome?.completed_lookups;
  const passed = outcome?.status === expected && (expected === "completed" ? verified_context : !artifact);
  console.log(JSON.stringify({ name, passed: !!passed, status: outcome?.status,
    context_bytes: new TextEncoder().encode(markdown).length, read_pages: outcome?.read_pages ?? 0,
    draft_attempts: outcome?.activity.filter(step => step.kind === "draft_started").length ?? 0 }));
  if (!passed) process.exitCode = 1;
}
