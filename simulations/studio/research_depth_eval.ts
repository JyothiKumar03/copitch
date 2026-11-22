// Replays one approved studio brief through the live research agent and reports checklist coverage and the context.
// bun --env-file=.env simulations/studio/research_depth_eval.ts <brief.json>
import { SessionStore } from "../../backend/src/repositories/session";
import { configured_models_for } from "../../backend/src/services/model-config";
import { research_provider } from "../../backend/src/services/research-provider";
import { context_markdown } from "../../backend/src/services/context-markdown";
import { ResearchWorker } from "../../backend/src/workers/research";
import { prepare_pitch } from "../../backend/src/services/pitch";
import type { TResearchBrief } from "../../backend/src/types/research";

const models = configured_models_for("research");
if (!models.length || !process.env.OPENAI_API_KEY) throw new Error("Configure the research provider before running this eval.");
// --from-bundle <file> skips research and plans the deck from a saved bundle.
const saved_bundle = process.argv.indexOf("--from-bundle");
const source = JSON.parse(await Bun.file(process.argv[2]).text()) as TResearchBrief;
const brief: TResearchBrief = { ...source, brief_id: crypto.randomUUID() };
const db = new SessionStore(":memory:");
db.replace_brief("eval", undefined, brief);
const job = db.research_jobs.enqueue("eval", brief.brief_id);
const started = Date.now();
// Print the independent checker's verdicts so a withheld brief shows why.
const traced = () => {
  const provider = research_provider(models[0], undefined, models);
  const verify = provider.verify!;
  provider.verify = async (review, signal, on_attempt) => {
    console.error("VERIFY_REQUEST", review.units.length, "units", JSON.stringify(review).length, "bytes", "coverage:", !!review.coverage);
    const verdicts = await verify(review, signal, on_attempt).catch(error => {
      console.error("VERIFY_ERROR", error?.name, String(error?.message).slice(0, 600), JSON.stringify(error?.cause ?? error?.responseBody ?? "").slice(0, 600));
      throw error;
    });
    const list = Array.isArray(verdicts) ? verdicts : verdicts.verdicts;
    const counts = list.reduce<Record<string, number>>((all, v) => ({ ...all, [v.decision]: (all[v.decision] ?? 0) + 1 }), {});
    console.error("VERIFY", review.units.length, "units", JSON.stringify(counts));
    for (const v of list.filter(v => v.decision !== "supported").slice(0, 6)) console.error("  ", v.id, v.decision, v.reason?.slice(0, 220));
    return verdicts;
  };
  return provider;
};
if (saved_bundle < 0) await new ResearchWorker(() => db, traced).tick(job.job_id);
const outcome = db.research_jobs.get("eval", job.job_id);
for (const event of outcome?.activity ?? []) console.log(`${String(event.sequence).padStart(3)} ${event.kind.padEnd(20)} ${event.label}`);
const bundle = saved_bundle > 0 ? JSON.parse(await Bun.file(process.argv[saved_bundle + 1]).text()) : db.research_by_brief("eval", brief.brief_id);
if (bundle && saved_bundle < 0) await Bun.write((process.argv[3] ?? "research") + ".bundle.json", JSON.stringify(bundle));
const markdown = bundle ? context_markdown(bundle) : "";
const numbers = [...markdown].filter(character => character >= "0" && character <= "9").length;
console.log(JSON.stringify({ status: outcome?.status, error: outcome?.error, seconds: Math.round((Date.now() - started) / 1000),
  tool_steps: outcome?.tool_steps, pages_read: outcome?.read_pages, evidence: bundle?.evidence.length,
  sections: bundle?.findings.sections.length, characters: markdown.length, digits: numbers }, null, 1));
await Bun.write(process.argv[3] ?? "/dev/stdout", markdown);

// With --deck, plan a six-slide deck from the saved research and print each slide's template and spoken script.
if (bundle && process.argv.includes("--deck")) {
  const deck = await prepare_pitch(bundle, { slide_count: 6 });
  await Bun.write((process.argv[3] ?? "research") + ".deck.json", JSON.stringify(deck));
  console.error("DECK", deck.slides.length, "slides ·", deck.pitch?.rationale?.slice(0, 200));
  for (const slide of deck.slides) {
    const template = slide.template;
    const points = template && "points" in template ? template.points.map(point => `${point.label}=${point.value}`).join(", ") : "";
    console.error(`- [${template?.type ?? "bullets"}] ${slide.title}${points ? "  {" + template!.unit + ": " + points + "}" : ""}`);
    console.error("    says:", slide.narration.slice(0, 320));
  }
}
