import { serve_api } from "../../backend/tests/helpers/serve-api";
import { score_fish_exports } from "./fish_exports_coverage_eval";
import { score_portfolio_pitch } from "./pitch_coverage_eval";
import { portfolio_facts, portfolio_url } from "./portfolio_reference";

const output = process.argv[2];
const scenario = process.argv[3] ?? "portfolio";
const supplied_urls = process.argv.slice(4);
if (!output || !["portfolio", "fish-exports"].includes(scenario) || supplied_urls.length > 8 || (scenario === "portfolio" && supplied_urls.length)) {
  throw new Error("Usage: bun --env-file=.env simulations/studio/portfolio_research_eval.ts <new-context.md> [portfolio|fish-exports [approved-https-url ...]]");
}
if (await Bun.file(output).exists()) throw new Error("Choose a new output path to keep earlier results available for comparison.");
if (!process.env.OPENAI_API_KEY) throw new Error("Configure the existing OpenAI provider to run the live evaluation.");

const portfolio = scenario === "portfolio";
const approved_urls = portfolio ? [portfolio_url] : supplied_urls.map(value => {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("Use public HTTPS source URLs without credentials or ports.");
  url.hash = "";
  return url.href;
});
const prompt = portfolio
  ? `Use my public portfolio at ${portfolio_url} to prepare detailed standalone reference context for my new coworkers. I am Jyothi Kumar and want the team to know what I have done and where I can help. Cover my education and exact GPA, every role with dates, what the cited impact metrics measured, every project listed in the portfolio and what it does, and material gaps. No decision or action is required from the team. Show the public research plan before starting.`
  : "Research India's fish export market in calendar year 2026 to date. I need a detailed context document for my strategy team to understand export-market size. Give export value, volume and major markets if reported. Separate frozen fish from total seafood and shrimp. Use official trade data. Label periods and units, and chart directly comparable figures if supported. If comparable calendar 2026 figures are unavailable, say so and give the latest official FY 2025–26 benchmark separately. Show the research plan before starting. " +
    (approved_urls.length
      ? "Use the official sources selected in the studio. In the quick-estimates table, report the USD million marine-products values for October 2026 and April–October 2026 separately. In the MPEDA fiscal data, report the frozen fish volume in MT and value in USD millions."
      : "Use current public web search to find the official sources yourself.");
// The live project index was rechecked on Nov 21 and no longer lists Live Slides.
// Keep the earlier reference intact for evaluating previously saved runs.
const current_portfolio_reference = portfolio_facts.filter(fact => fact.id !== "project:live-slides");
const score = (markdown: string) => portfolio ? score_portfolio_pitch(markdown, true, current_portfolio_reference) : score_fish_exports(markdown, approved_urls.length > 0, true);

// Run the regular API and leased worker against a fresh database and random account.
process.env.AI_SESSION_DB = ":memory:";
const { default: app } = await import("../../backend/src/app");
const { research_worker } = await import("../../backend/src/controllers/research");
await using http = await serve_api(app);
const credential = { email: `pitch-coverage-${crypto.randomUUID()}@example.test`, password: crypto.randomUUID() };
let cookie = "";
const send = async (path: string, body?: unknown) => {
  const response = await http.request(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(cookie && { Cookie: cookie }), ...(body !== undefined && { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(`${path} returned ${response.status}: ${typeof error?.error === "string" ? error.error : "request failed"}`);
  }
  return response;
};

const sign_in = async (endpoint: "register" | "login") => {
  const response = await send(`/api/account/${endpoint}`, credential);
  const issued = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!issued) throw new Error("Sign-in failed to issue a cookie.");
  cookie = issued;
};

const run = async () => {
  const started = Date.now();
  await sign_in("register");
  const project = await (await send("/api/projects", { name: `${scenario} coverage evaluation` })).json();
  if (typeof project?.session_id !== "string") throw new Error("Expected a private project ID.");
  const project_path = `/api/sessions/${encodeURIComponent(project.session_id)}`;
  const turn = async (message: string, choice?: { answer_to: string; option_id: "approve" }) => {
    return (await send(project_path + "/interview/turn", {
      message, turn_id: crypto.randomUUID(), input: "typed", ...choice,
      ...(!choice && { urls: approved_urls, source_policy: "public_search" }),
    })).json();
  };
  let proposal = await turn(prompt);
  if (!portfolio && proposal.phase === "interview") {
    proposal = await turn("The audience is my strategy team. The goal is to understand market size and destination mix. Deliver standalone research context with citations and a chart where the evidence supports one. Use calendar 2026 where data is comparable and label the fiscal benchmark separately. Show the proposed scope for approval.");
  }
  const plan = proposal.proposal;
  const authorized_sources = approved_urls.length
    ? Array.isArray(plan?.urls) && approved_urls.every(url => plan.urls.includes(url))
    : Array.isArray(plan?.queries) && plan.queries.length > 0;
  if (proposal.phase !== "proposed" || !plan || typeof plan.proposal_id !== "string" || plan.source_policy !== "public_search" || !authorized_sources) {
    throw new Error(`Expected a reviewable public-source plan for ${scenario}, received phase ${proposal.phase ?? "unknown"}. ${proposal.text ?? ""}`);
  }
  const approval = await turn("Start research", { answer_to: plan.proposal_id, option_id: "approve" });
  const job_id = approval.workspace?.job?.job_id;
  const brief_id = approval.workspace?.brief?.brief_id;
  if (typeof job_id !== "string" || typeof brief_id !== "string") throw new Error("Approval failed to enqueue a revision-bound research job.");

  // A fresh login should see the same job or finished result, with no reliance on the original connection.
  await send("/api/account/logout", {});
  cookie = "";
  await sign_in("login");
  const projects = await (await send("/api/projects")).json();
  if (!Array.isArray(projects?.projects) || !projects.projects.some((item: { session_id?: string }) => item.session_id === project.session_id)) {
    throw new Error("The private project did not survive fresh login.");
  }

  const job_path = project_path + `/research/jobs/${encodeURIComponent(job_id)}`;
  let job = await (await send(job_path)).json();
  const deadline = Date.now() + 270_000;
  while (job.status === "queued" || job.status === "running") {
    if (Date.now() >= deadline) throw new Error("Research did not complete within the evaluation deadline.");
    await Bun.sleep(1_000);
    job = await (await send(job_path)).json();
  }
  if (job.brief_id !== brief_id) throw new Error("The job no longer points to the approved brief revision.");
  const research_id = job.result?.research_id;
  const activity = Array.isArray(job.activity) ? job.activity.map((item: { kind?: string; label?: string }) => ({ kind: item.kind, label: item.label })) : [];
  const workspace = await (await send(project_path + "/interview/workspace")).json();
  if (job.status !== "completed" || typeof research_id !== "string") {
    console.log(JSON.stringify({ status: job.status, error: job.error, elapsed_ms: Date.now() - started,
      artifact_available: typeof workspace.research?.research_id === "string", activity, ...score("") }, null, 2));
    process.exitCode = 1;
    return;
  }
  if (workspace.research?.research_id !== research_id || workspace.brief?.brief_id !== brief_id) {
    throw new Error("Fresh workspace points to a different saved revision.");
  }
  const response = await send(project_path + `/research/${encodeURIComponent(research_id)}/context.md`);
  const markdown = await response.text();
  await Bun.write(output, markdown);
  const report = score(markdown);
  console.log(JSON.stringify({ status: job.status, elapsed_ms: Date.now() - started, output, activity,
    tool_steps: job.tool_steps, read_pages: job.read_pages, research_passes: job.research_passes, ...report }, null, 2));
  if (!report.passed) process.exitCode = 1;
};

research_worker.start();
try {
  await run();
} finally {
  research_worker.stop();
}
