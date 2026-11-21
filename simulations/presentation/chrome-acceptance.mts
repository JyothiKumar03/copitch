// Run only against a configured local preview. This creates a synthetic account and uses its live providers.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import type { Page, Response as BrowserResponse } from "playwright";
import type { TDeck } from "../../backend/src/types/deck";
import type { TPresentationAction, TPresentationState } from "../../backend/src/types/presentation-live";
import type { TResearchJob } from "../../backend/src/types/research-job";

const usage = `node simulations/presentation/chrome-acceptance.mts [--strict-plans]
  COPITCH_ACCEPT_WEB             Local web origin (default http://localhost:3000)
  COPITCH_ACCEPT_API             Optional local API origin (otherwise detected from the browser)
  COPITCH_ACCEPT_PLANNER_TRACE   Optional server log file collected with TRACE_LOGS=1
  COPITCH_ACCEPT_CHANNEL         Browser channel (default chrome, use bundled for Playwright Chromium)
  COPITCH_ACCEPT_SCREENSHOT      Optional path for the final preview screenshot
  --strict-plans                 Require two independently accepted, distinct audience plans
`;

const notes = `My name is Mira Kade. I lead customer onboarding for small businesses on an operations team.
I designed a multilingual setup guide after customers said the previous steps were unclear. I coached two colleagues on using it.
Our team documented 24 completed setups in week three. We do not know whether the guide caused the result.
My current goal is to make onboarding easier for customers and improve how teammates document setup outcomes.`;
const operations = "New operations teammates learning Mira’s onboarding workflow";
const hiring = "Hiring panel evaluating Mira’s evidence of impact and its limits";

type TBriefing = { phase?: string; text: string; proposal?: { source_policy: string }; workspace: { job: { job_id: string } | null } };
type TPlaybackEvent = { action: Extract<TPresentationAction, { kind: "playing" | "ended" }>; state: TPresentationState };

const loopback = (url: URL) => ["http:", "https:"].includes(url.protocol) &&
  ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && !url.username && !url.password;
const localOrigin = (value: string) => {
  const url = new URL(value);
  assert.ok(loopback(url), "Use a local preview origin for the synthetic rehearsal");
  return url.origin;
};
const report = (step: string, fields: Record<string, unknown>) => console.log(JSON.stringify({ step, ...fields }));
const postedTo = (response: BrowserResponse, path: string) =>
  response.request().method() === "POST" && new URL(response.url()).pathname.endsWith(path);

const checkJson = async <T,>(response: BrowserResponse, action: string): Promise<T> => {
  const value = await response.json();
  assert.ok(response.ok(), `${action} ${response.status()}: ${JSON.stringify(value)}`);
  return value as T;
};
const observe = (pending: Promise<BrowserResponse>) => {
  void pending.catch(() => {});
  return pending;
};
const waitFor = async <T,>(label: string, inspect: () => T | Promise<T>, timeout = 55_000): Promise<NonNullable<T>> => {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await inspect();
    if (value) return value;
    if (Date.now() > deadline) throw Error(`Timed out waiting for ${label}`);
    await delay(160);
  }
};

const sendStudio = async (page: Page, message?: string) => {
  const pending = observe(page.waitForResponse(response => postedTo(response, "/interview/turn"), { timeout: 60_000 }));
  if (message) await page.getByLabel("Your message").fill(message);
  await page.getByRole("button", { name: message ? "Send" : "Start research", exact: true }).click();
  const response = await pending;
  return { briefing: await checkJson<TBriefing>(response, "Studio turn"), api: localOrigin(response.url()) };
};

const openContext = async (page: Page) => {
  const stream = observe(page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/context.md") &&
    response.request().headers().accept === "text/event-stream"));
  await page.getByRole("button", { name: "context.md", exact: true }).click();
  const response = await stream;
  assert.equal(response.status(), 200);
  assert.match(response.headers()["content-type"], /^text\/event-stream/u);
  const dialog = page.getByRole("dialog", { name: "Context artifact" });
  await dialog.getByRole("button", { name: "Markdown", exact: true }).click();
  const markdown = await dialog.getByLabel("Markdown source").textContent();
  assert.ok(markdown);
  assert.match(markdown, /(?:\b24\b[^.\n]{0,70}\bsetups?\b|\bsetups?\b[^.\n]{0,70}\b24\b)/iu);
  assert.match(markdown, /uncertain|unknown|do not know|does not establish|no evidence of causation|cannot (?:infer|conclude)/iu);
  assert.doesNotMatch(markdown, /^## (?:Talk track|Speaker notes)\b/imu);
  const downloaded = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download context.md", exact: true }).click();
  const file = await downloaded;
  assert.equal(file.suggestedFilename(), "context.md");
  assert.deepEqual(await readFile(await file.path()), Buffer.from(markdown));
  await dialog.getByRole("button", { name: "Close artifact" }).click();
  return markdown;
};

const prepare = async (page: Page, audience: string, variant = false) => {
  if (variant) await page.getByRole("button", { name: "Change audience or duration" }).click();
  await page.getByLabel("Audience", { exact: true }).fill(audience);
  await page.getByLabel("Speaking time (minutes)").fill("2");
  await page.getByText("Slide count and walkthrough", { exact: true }).click();
  await page.getByLabel("Slide count", { exact: true }).fill("2");
  const pending = observe(page.waitForResponse(response => postedTo(response, "/decks"), { timeout: 100_000 }));
  await page.getByRole("button", { name: "Prepare slides", exact: true }).click();
  const deck = await checkJson<TDeck>(await pending, "Prepare deck");
  await page.getByRole("heading", { name: "Presentation preview" }).waitFor();
  assert.equal(deck.pitch?.audience, audience);
  assert.ok(deck.slides.length);
  return deck;
};

const plannerOutcomes = async (researchId: string) => {
  const path = process.env.COPITCH_ACCEPT_PLANNER_TRACE;
  if (!path) return [];
  const terminal = new Set(["accepted", "accepted_verified_subset", "provider_unavailable", "rejected_constraints", "rejected_schema",
    "rejected_verification", "proposal_failed"]);
  return (await readFile(path, "utf8")).split("\n").flatMap(line => {
    try {
      const value = JSON.parse(line);
      return value?.operation === "presentation.plan_acceptance" && value.research_id === researchId && terminal.has(value.outcome)
        ? [String(value.outcome)] : [];
    } catch { return []; }
  });
};

const rehearse = async () => {
  const web = localOrigin(process.env.COPITCH_ACCEPT_WEB ?? "http://localhost:3000");
  const explicitApi = process.env.COPITCH_ACCEPT_API && localOrigin(process.env.COPITCH_ACCEPT_API);
  const channel = process.env.COPITCH_ACCEPT_CHANNEL ?? "chrome";
  const browser = await chromium.launch(channel === "bundled" ? {} : { channel });
  const email = `chrome-acceptance-${randomUUID()}@example.test`;
  const password = randomUUID();
  const projectName = "Synthetic onboarding introduction";
  const signIn = async (register: boolean) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true,
      permissions: ["clipboard-read", "clipboard-write"] });
    await context.route(/\/api\//u, route => loopback(new URL(route.request().url())) ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(40_000);
    await page.goto(`${web}/research`);
    if (register) await page.getByRole("button", { name: "Create an account" }).click();
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: register ? "Create account" : "Sign in", exact: true }).click();
    await page.getByLabel("Project name").waitFor();
    return { context, page };
  };

  try {
    const first = await signIn(true);
    const { page } = first;
    assert.ok((await first.context.request.get(`${web}/audience`)).ok());
    await page.getByLabel("Project name").fill(projectName);
    await page.getByRole("button", { name: "New project" }).click();
    await page.evaluate(text => navigator.clipboard.writeText(text), notes);
    await page.getByLabel("Your message").focus();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+v" : "Control+v");
    await page.getByRole("button", { name: /Remove Pasted text/u }).waitFor();
    await page.getByRole("button", { name: /Public research allowed/u }).click();
    await page.getByRole("button", { name: "Apply sources" }).click();
    await page.getByRole("button", { name: "Apply sources" }).waitFor({ state: "hidden" });

    let { briefing } = await sendStudio(page, "Prepare a two-minute personal introduction about me, Mira Kade, for my new operations teammates. Explain my onboarding work and how I record outcomes. This is informational. Use only my pasted notes and preserve the 24 completed setups and the uncertainty about cause.");
    if (briefing.phase !== "proposed") {
      ({ briefing } = await sendStudio(page, "Show the files-only research plan now. Use the pasted material for an informational introduction to the new operations team."));
    }
    assert.equal(briefing.phase, "proposed", briefing.text);
    assert.equal(briefing.proposal?.source_policy, "files_only");
    assert.equal(briefing.workspace.job, null);
    const started = await sendStudio(page);
    const jobId = started.briefing.workspace.job?.job_id;
    const projectUrl = page.url();
    const sessionId = new URL(projectUrl).searchParams.get("project");
    const api = explicitApi || started.api;
    assert.ok(jobId && sessionId);
    const base = `${api}/api/sessions/${sessionId}`;
    await page.getByRole("button", { name: "context.md", exact: true }).or(page.getByRole("heading", { name: "More evidence needed" }))
      .or(page.getByRole("heading", { name: "Research could not finish" })).first().waitFor({ timeout: 180_000 });
    const jobResponse = await first.context.request.get(`${base}/research/jobs/${jobId}`);
    assert.ok(jobResponse.ok());
    const job = await jobResponse.json() as TResearchJob;
    assert.equal(job.status, "completed", job.error);
    assert.equal(job.read_pages, 0);
    assert.equal(job.completed_lookups, 0);
    const context = await openContext(page);
    await first.context.close();

    const returning = await signIn(false);
    const host = returning.page;
    await host.getByRole("link", { name: projectName }).click();
    assert.equal(host.url(), projectUrl);
    assert.equal(await openContext(host), context);
    report("context_reopened", { bytes: Buffer.byteLength(context), pages: job.read_pages, passes: job.research_passes, metric: 24 });

    await host.getByText("Presentation options", { exact: true }).click();
    const primary = await prepare(host, operations);
    const firstOutcomes = await plannerOutcomes(primary.research_id);
    await host.getByRole("heading", { name: "Private narration", exact: true }).waitFor();
    const downloaded = host.waitForEvent("download");
    await host.getByRole("button", { name: "Download offline slides" }).click();
    const file = await downloaded;
    assert.equal(file.suggestedFilename(), `presentation-r${primary.revision}.html`);
    const html = await readFile(await file.path(), "utf8");
    assert.match(html, /slide-shell/u);
    assert.doesNotMatch(html, /<script\b|Private narration/iu);

    const playback: TPlaybackEvent[] = [];
    host.on("response", async response => {
      if (!postedTo(response, "/live/commands") || !response.ok()) return;
      const { action } = response.request().postDataJSON() as { action: TPresentationAction };
      if (action.kind !== "playing" && action.kind !== "ended") return;
      try { playback.push({ action, state: await response.json() as TPresentationState }); } catch { /* Aborted during browser teardown. */ }
    });
    const audio = observe(host.waitForResponse(response => response.url().includes("/live/audio/") && response.ok(), { timeout: 55_000 }));
    await host.getByRole("button", { name: "Approve and present", exact: true }).click();
    assert.match((await audio).headers()["content-type"], /^audio\/mpeg/u);
    await waitFor("host playing acknowledgement", () => playback.find(event => event.action.kind === "playing"));
    const opened = host.waitForEvent("popup");
    await host.getByRole("button", { name: "Open audience screen", exact: true }).click();
    const audience = await opened;
    const stage = audience.locator(".slide-shell");
    await stage.waitFor();
    const audienceText = await stage.innerText();
    assert.ok(primary.slides.some(slide => audienceText.includes(slide.title)));
    const publicView = await audience.evaluate(async origin => {
      const response = await fetch(`${origin}/api/audience`, { headers: { Authorization: `Bearer ${location.hash.slice(1)}` } });
      if (!response.ok) throw Error(`Audience projection ${response.status}`);
      return response.json();
    }, api);
    assert.ok(!("narration" in publicView.slide) && !("sentences" in publicView.slide) && !("proposal" in publicView));
    report("live_deck_opened", { titles: primary.slides.map(slide => slide.title), hostAudio: true, separateStage: true, privateSafeHtml: true });

    const liveState = async () => {
      const response = await returning.context.request.get(`${base}/decks/${primary.deck_id}/live`);
      assert.ok(response.ok(), `Presentation state ${response.status()}`);
      return await response.json() as TPresentationState;
    };
    const command = async (name: string, kind: TPresentationAction["kind"]) => {
      const pending = observe(host.waitForResponse(response => postedTo(response, "/live/commands") &&
        response.request().postDataJSON()?.action?.kind === kind));
      await host.getByRole("button", { name, exact: true }).click();
      return checkJson<TPresentationState>(await pending, name);
    };
    const ask = async (message: string) => {
      await host.getByRole("textbox", { name: "Private question or correction" }).fill(message);
      const pending = observe(host.waitForResponse(response => postedTo(response, "/live/turns")));
      await host.getByRole("button", { name: "Send privately", exact: true }).click();
      return checkJson<TPresentationState>(await pending, "Presentation turn");
    };
    await waitFor("external stage narration", async () => {
      const state = await liveState();
      return state.painted && state.attempt?.kind === "narration" && playback.some(event =>
        event.action.kind === "playing" && event.action.attempt_id === state.attempt?.attempt_id);
    });
    const { pin } = await command("Interrupt", "interrupt");
    assert.ok(pin);
    const answered = await ask("How many completed setups did the team document in week three?");
    assert.equal(answered.last_reply?.kind, "answer");
    assert.match(answered.last_reply.text, /24|twenty.four/iu);
    assert.ok(answered.last_reply.evidence_ids.length);
    assert.equal(answered.attempt?.kind, "answer");
    const resumed = await waitFor("spoken answer and resume", () => playback.find(event =>
      event.action.kind === "ended" && event.action.attempt_id === answered.attempt?.attempt_id));
    assert.deepEqual(resumed.state.cursor, { slide_id: pin.slide_id, sentence_index: pin.sentence_index });
    report("cited_answer_resumed", { sentence: pin.sentence_index, citations: answered.last_reply.evidence_ids.length });

    const opening = primary.slides[0];
    if ((await liveState()).cursor.slide_id !== opening.slide_id) await host.getByLabel("Go to slide").selectOption(opening.slide_id);
    await waitFor("opening slide paint", async () => {
      const state = await liveState();
      return state.painted && state.cursor.slide_id === opening.slide_id;
    });
    const edit = /coach(?:ed|ing)[^.!?]{0,35}(?:two|2) colleagues/iu.test([...opening.highlights, opening.narration].join(" "))
      ? "A new note from me: I keep a short weekly list of questions teammates receive about setup. Add that fact as one visible highlight and one narration sentence to the current slide. Attribute it to me."
      : "On the current slide, add one short visible highlight that I coached two colleagues on using the multilingual setup guide. Add that same fact as one new narration sentence. Cite my pasted notes.";
    const draft = await ask(edit);
    assert.ok(draft.proposal, JSON.stringify(draft.last_reply));
    const draftHighlight = draft.proposal.after.highlights.find(text => !draft.proposal?.before.highlights.includes(text));
    assert.ok(draftHighlight);
    assert.equal(await stage.getByText(draftHighlight, { exact: true }).count(), 0);
    const rejected = await command("Keep current slide", "decide");
    assert.equal(rejected.revision, draft.revision);
    assert.deepEqual(rejected.cursor, draft.cursor);
    assert.equal(rejected.status, "paused");

    const repeated = await ask(edit);
    const added = repeated.proposal?.after.highlights.find(text => !repeated.proposal?.before.highlights.includes(text));
    assert.ok(added, JSON.stringify(repeated.last_reply));
    await host.getByText("Applying shows the revised slide and plays the new narration before advancing.").waitFor();
    const accepted = await command("Apply and continue", "decide");
    assert.equal(accepted.revision, rejected.revision + 1);
    assert.equal(accepted.cursor.slide_id, opening.slide_id);
    await stage.getByText(added, { exact: true }).waitFor();
    const advanced = await waitFor("approved narration to finish before advancing", () => playback.find(event =>
      event.action.kind === "ended" && event.state.revision === accepted.revision &&
      (event.state.cursor.slide_id !== opening.slide_id || event.state.status === "completed") &&
      playback.some(start => start.action.kind === "playing" && start.action.attempt_id === event.action.attempt_id && start.state.attempt?.kind === "accepted_edit")));
    const next = primary.slides[1];
    if (next) assert.equal(advanced.state.cursor.slide_id, next.slide_id);
    else assert.equal(advanced.state.status, "completed");
    report("private_edit_applied", { rejectionKeptRevision: true, revision: accepted.revision, audienceRepainted: true,
      afterNarration: next ? "next_slide" : "deck_complete" });

    await host.getByRole("button", { name: "Exit live view" }).click();
    await host.getByRole("heading", { name: "Presentation preview" }).waitFor();
    await audience.close();
    const secondary = await prepare(host, hiring, true);
    assert.notEqual(primary.deck_id, secondary.deck_id);
    assert.equal(primary.research_id, secondary.research_id);
    const publicAndSpoken = (deck: TDeck) => deck.slides.map(({ title, highlights, template, narration }) => ({ title, highlights, template, narration }));
    const distinctContent = JSON.stringify(publicAndSpoken(primary)) !== JSON.stringify(publicAndSpoken(secondary));
    const secondOutcomes = (await plannerOutcomes(primary.research_id)).slice(firstOutcomes.length);
    const plans = [firstOutcomes, secondOutcomes].map((attempts, index) => ({ audience: index ? hiring : operations,
      outcome: attempts.at(-1) ?? "unobserved", attempts }));
    const anyVerified = plans.some(plan => plan.outcome === "accepted" || plan.outcome === "accepted_verified_subset");
    const independent = plans.every(plan => plan.outcome === "accepted") ? "accepted" : anyVerified ? "partial" :
      plans.every(plan => plan.outcome !== "unobserved") ? "rejected" : "unobserved";
    report("audience_planning", { researchId: primary.research_id, browser: "passed", distinctContent, independent, plans,
      adaptation: independent === "accepted" && distinctContent ? "verified" : distinctContent ? "partial" : "unverified",
      titles: [primary.slides.map(slide => slide.title), secondary.slides.map(slide => slide.title)] });
    const screenshot = process.env.COPITCH_ACCEPT_SCREENSHOT;
    if (screenshot) await host.screenshot({ path: screenshot });
    if (process.argv.includes("--strict-plans")) assert.ok(independent === "accepted" && distinctContent, "Both audience plans must pass independent verification and differ");
  } finally { await browser.close(); }
};

if (process.argv.includes("--help")) console.log(usage);
else rehearse().catch(error => { console.error(error); process.exitCode = 1; });
