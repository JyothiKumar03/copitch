import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { chromium, type Page } from "playwright";

const directory = await mkdtemp(join(tmpdir(), "copitch-studio-check-"));
const apiPort = Number(process.env.STUDIO_CHECK_API_PORT || 3491);
const webPort = Number(process.env.STUDIO_CHECK_WEB_PORT || 3490);
const api = "http://127.0.0.1:" + apiPort;
const web = "http://127.0.0.1:" + webPort;
const env = { ...process.env, NODE_ENV: "development", OPENAI_API_KEY: "", CORS_ORIGIN: web, NEXT_PUBLIC_API_URL: api, NEXT_TELEMETRY_DISABLED: "1" };
const startApi = () => spawn(process.execPath, ["backend/tests/fixtures/studio-api.ts", join(directory, "check.sqlite"), String(apiPort), web],
  { env, stdio: ["ignore", process.env.TRACE_LOGS === "1" ? "inherit" : "ignore", "inherit"] });
const ready = async (url: string, child: ChildProcess) => {
  for (let i = 0; i < 160; i++) {
    if (child.exitCode !== null) throw Error("Fixture process exited with code " + child.exitCode);
    if (await fetch(url).then(response => response.ok).catch(() => false)) return;
    await delay(250);
  }
  throw Error("Fixture did not start at " + url);
};
const signIn = async (page: Page, email: string, password: string, register: boolean) => {
  await page.goto(web + "/research");
  await page.getByLabel("Email").waitFor({ timeout: 15_000 }).catch(async cause => {
    throw Error((await page.locator("body").innerText()).slice(0, 1200), { cause });
  });
  if (register) await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: register ? "Create account" : "Sign in", exact: true }).click();
  await page.getByLabel("Project name").waitFor();
};
const pasteSource = async (page: Page, text: string) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: web });
  await page.evaluate(value => navigator.clipboard.writeText(value), text);
  await page.getByLabel("Your message").focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+v" : "Control+v");
  await page.getByRole("button", { name: /Remove Pasted text/ }).waitFor();
};
const stop = async (child: ChildProcess) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill();
  const force = setTimeout(() => child.kill("SIGKILL"), 1500);
  try { await exited; } finally { clearTimeout(force); }
};
const webDirectory = join(directory, "frontend");
await cp("frontend", webDirectory, { recursive: true,
  filter: path => !["node_modules", ".next", "tsconfig.tsbuildinfo"].includes(basename(path)) && !basename(path).startsWith(".env") });
await cp("shared", join(directory, "shared"), { recursive: true });
await cp("tsconfig.base.json", join(directory, "tsconfig.base.json"));
await symlink(resolve("frontend/node_modules"), join(webDirectory, "node_modules"));
let server = startApi();
const next = spawn("node", ["node_modules/next/dist/bin/next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(webPort)],
  { cwd: webDirectory, env, stdio: ["ignore", "ignore", "inherit"] });
try {
  await Promise.all([ready(api + "/api/health", server), ready(web + "/research", next)]);
  await ready(web + "/deck-render-check", next);
  const browser = await chromium.launch({ channel: process.env.DECK_BROWSER_CHANNEL || "chrome" });
  try {
    const owner = "owner-" + crypto.randomUUID() + "@example.test";
    const password = crypto.randomUUID();
    const first = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await first.newPage();
    await signIn(page, owner, password, true);
    await page.getByLabel("Project name").fill("November revenue");
    await page.getByRole("button", { name: "New project" }).click();
    const conversation = page.getByLabel("Private conversation");
    await conversation.waitFor();
    await conversation.getByRole("heading", { name: "What do you want to pitch?" }).waitFor();
    assert.equal(await conversation.getByRole("region", { name: "Research plan" }).count(), 0);
    const chat = await conversation.boundingBox();
    const agent = await page.getByLabel("Agent and microphone controls").boundingBox();
    assert.ok(chat && agent && chat.x + chat.width <= agent.x + 1, "Agent must be to the right of the conversation");
    await first.grantPermissions([], { origin: web });
    await page.getByRole("button", { name: "Start voice conversation" }).click();
    assert.equal(await page.evaluate(async () => (await navigator.permissions.query({ name: "microphone" as PermissionName })).state), "denied");
    await page.getByRole("button", { name: /Public research allowed/ }).click();
    await page.locator('input[type="file"]').setInputFiles({name: "pilot.csv", mimeType: "text/csv", buffer: Buffer.from("topic,reviewer\nRevenue,Board\n")});
    await page.getByText("pilot.csv", { exact: false }).first().waitFor();
    await pasteSource(page, "Revenue in January 2025: USD 1,200.\nRevenue in February 2025: USD 1,500.");
    await page.getByLabel("Your message").fill("Prepare a revenue review for the board. Ask them to approve the pilot.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const plan = page.getByRole("region", { name: "Research plan" });
    await plan.waitFor();
    assert.equal(await plan.count(), 1);
    const started = page.waitForResponse(response => response.url().endsWith("/interview/turn") && response.request().method() === "POST" &&
      response.request().postDataJSON()?.option_id === "approve");
    await page.getByRole("button", { name: "Start research", exact: true }).click();
    const startResponse = await started;
    assert.equal(startResponse.status(), 200);
    const job = (await startResponse.json()).workspace.job;
    const projectId = new URL(page.url()).searchParams.get("project");
    const duplicate = await first.request.post(api + "/api/sessions/" + projectId + "/research", { headers: { Prefer: "respond-async" }, data: { brief_id: job.brief_id, confirmed: true } });
    assert.equal((await duplicate.json()).job_id, job.job_id);
    for (const question of ["Is it ready yet?", "हो गया?"]) {
      await page.getByLabel("Your message").fill(question);
      const progress = page.waitForResponse(response => response.url().endsWith("/interview/turn") && response.request().method() === "POST");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      const reply = await (await progress).json();
      assert.equal(reply.workspace.job.job_id, job.job_id);
      assert.equal(reply.workspace.brief.brief_id, job.brief_id);
    }
    const projectUrl = page.url();
    await first.close();
    await stop(server);
    server = startApi();
    await ready(api + "/api/health", server);

    const returning = await browser.newContext();
    const reopened = await returning.newPage();
    await signIn(reopened, owner, password, false);
    await reopened.getByRole("link", { name: "November revenue" }).click();
    assert.equal(reopened.url(), projectUrl);
    const slideCount = reopened.getByRole("log", { name: "Conversation messages" }).getByRole("spinbutton", { name: "How many slides?", exact: true });
    await slideCount.waitFor({ timeout: 45_000 });
    assert.equal(await reopened.getByRole("button", { name: /context\.md/i }).count(), 0);
    assert.equal(await reopened.getByRole("article", { name: "Context document" }).count(), 0);
    const session = new URL(projectUrl).searchParams.get("project");
    const workspace = await returning.request.get(api + "/api/sessions/" + session + "/interview/workspace");
    const state = await workspace.json();
    assert.equal(state.job.status, "completed");
    assert.equal(state.job.job_id, job.job_id);
    assert.equal(state.brief.brief_id, job.brief_id);
    for (const question of ["Is it ready yet?", "हो गया?"]) assert.ok(state.brief.history.some((turn: {text: string}) => turn.text === question));
    assert.equal(state.job.activity.filter((event: {kind: string}) => event.kind === "completed").length, 1);
    assert.equal(state.job.activity.some((event: {kind: string}) => event.kind === "lookup_requested"), false);
    if (process.env.STUDIO_CHECK_SCREENSHOT) await reopened.screenshot({ path: process.env.STUDIO_CHECK_SCREENSHOT });
    const reads: number[] = [];
    const artifactUrl = api + "/api/sessions/" + session + "/research/" + state.research.research_id + "/context.md";
    const contextResponse = await returning.request.get(artifactUrl);
    assert.equal(contextResponse.status(), 200);
    const source = await contextResponse.text();
    assert.match(source, /<graph>[^\n]*<\/graph>/);
    assert.match(source, /January 2025/);
    assert.match(source, /1,?200/);
    assert.match(source, /1,?500/);
    assert.doesNotMatch(source, /^## (?:Talk track|Speaker notes)\b/im);
    const stream = await returning.request.get(artifactUrl, { headers: { Accept: "text/event-stream" } });
    assert.match(stream.headers()["content-type"], /^text\/event-stream/);
    const events = await stream.text();
    const streamed = Array.from(events.matchAll(/^event: delta\ndata: (.+)$/gm), match => JSON.parse(match[1]).text).join("");
    assert.equal(streamed, source);
    assert.match(events, /^event: done$/m);
    for (let index = 0; index < 20; index++) {
      const before = performance.now();
      const response = await returning.request.get(artifactUrl);
      assert.equal(await response.text(), source);
      reads.push(performance.now() - before);
    }
    reads.sort((a, b) => a - b);
    console.log("Local authenticated Markdown read, 20 warm samples (ms):", { p50: reads[9].toFixed(1), p95: reads[18].toFixed(1) });
    assert.equal(await reopened.getByRole("heading", { name: "Prepare your presentation" }).count(), 0);
    assert.equal(await reopened.getByRole("button", { name: "Open original research slides" }).count(), 0);
    assert.equal(await reopened.getByLabel("Audience", { exact: true }).count(), 0);
    assert.equal(await reopened.getByLabel("Speaking time (minutes)").count(), 0);
    const generate = reopened.getByRole("button", { name: "Generate slides", exact: true });
    await slideCount.fill("13");
    assert.equal(await generate.isEnabled(), false);
    await slideCount.fill("1.5");
    assert.equal(await generate.isEnabled(), false);
    await slideCount.fill("2");
    const planned = reopened.waitForResponse(response => response.url().endsWith("/decks") && response.request().method() === "POST").catch(cause => {
      throw Error("Timed out waiting for deck preparation to be queued", { cause });
    });
    const preparationPoll = /\/decks\/preparations\/[0-9a-f-]{36}$/i;
    // Hold only the original page's first status read so reload always happens before that page sees completion.
    await reopened.route(preparationPoll, () => {}, { times: 1 });
    const beganPolling = reopened.waitForRequest(preparationPoll);
    await generate.click();
    const preparationResponse = await planned;
    assert.equal(preparationResponse.status(), 202, await preparationResponse.text());
    assert.deepEqual(preparationResponse.request().postDataJSON(), { research_id: state.research.research_id, pitch: { slide_count: 2 } });
    const preparation = await preparationResponse.json();
    assert.match(preparation.job_id, /^[0-9a-f-]{36}$/i);
    assert.ok(["queued", "running"].includes(preparation.status));
    const repeated = await returning.request.post(preparationResponse.url(), { data: preparationResponse.request().postDataJSON() });
    assert.ok([200, 202].includes(repeated.status()), await repeated.text());
    const repeatedResult = await repeated.json();
    if (repeated.status() === 202) assert.equal(repeatedResult.job_id, preparation.job_id);
    const preparationUrl = api + "/api/sessions/" + session + "/decks/preparations/" + preparation.job_id;
    assert.equal((await beganPolling).url(), preparationUrl);
    await reopened.reload({ waitUntil: "domcontentloaded" });
    await reopened.getByRole("heading", { name: "Presentation", exact: true }).waitFor();
    const preview = reopened.getByRole("heading", { name: "Presentation preview" });
    await preview.waitFor({ timeout: 100_000 }).catch(async cause => {
      const response = await returning.request.get(preparationUrl, { timeout: 5_000 });
      const result = await response.json();
      throw Error(`Presentation preview unavailable after preparation returned ${response.status()}: ${result.status} ${result.error ?? ""}`, { cause });
    });
    const preparedResponse = await returning.request.get(preparationUrl);
    assert.equal(preparedResponse.status(), 200);
    const prepared = await preparedResponse.json();
    assert.equal(prepared.job_id, preparation.job_id);
    assert.equal(prepared.status, "completed");
    const deck = prepared.deck;
    assert.ok(deck);
    if (repeated.status() === 200) assert.equal(repeatedResult.deck_id, deck.deck_id);
    assert.equal(deck.research_id, state.research.research_id);
    assert.equal(deck.render_review?.status, "passed");
    assert.ok(deck.render_review.rounds >= 1 && deck.render_review.rounds <= 3);
    console.log(`PASS reloading during preparation recovered a deck that passed browser review in ${deck.render_review.rounds} round(s)`);
    assert.ok(deck.slides.length >= 1 && deck.slides.length <= 2);
    assert.ok(deck.slides.some((slide: { template?: { points?: { value: number }[] } }) =>
      slide.template?.points?.some(point => point.value === 1200) && slide.template.points.some(point => point.value === 1500)),
    "Slide plan should reuse the verified research series");
    await reopened.getByRole("heading", { name: "Private narration" }).waitFor();
    assert.equal(await reopened.getByRole("button", { name: /Download plan|Share/i }).count(), 0);
    const deckDownload = reopened.waitForEvent("download");
    await reopened.getByRole("button", { name: "Download offline slides" }).click();
    const deckFile = await (await deckDownload).path();
    assert.ok(deckFile);
    const deckHtml = await readFile(deckFile, "utf8");
    assert.match(deckHtml, /slide-shell/);
    assert.match(deckHtml, /template-chart/);
    assert.match(deckHtml, /1,200/);
    assert.match(deckHtml, /1,500/);
    assert.doesNotMatch(deckHtml, /Private narration|<script\b/i);
    const painted = reopened.waitForResponse(response => response.url().endsWith("/api/audience/paint")).catch(cause => {
      throw Error("Timed out waiting for host slide paint", { cause });
    });
    await reopened.getByRole("button", { name: "Approve and present" }).click();
    await reopened.getByRole("heading", { name: "Live presentation" }).waitFor();
    assert.equal((await painted).status(), 204);
    assert.equal(await returning.pages().length, 1);
    assert.equal(await reopened.getByLabel("Go to slide").count(), 0);
    assert.equal(await reopened.getByRole("button", { name: /Share|Audience/i }).count(), 0);
    await reopened.getByRole("button", { name: "Exit live view" }).click();
    await preview.waitFor();
    await reopened.getByRole("button", { name: "Back to conversation" }).click();
    await slideCount.waitFor();
    await reopened.getByLabel("Prepared presentations").selectOption(deck.deck_id);
    await preview.waitFor();
    assert.equal((await returning.request.get(web + "/audience")).status(), 404);
    console.log("PASS signed-in context to deck review, private narration, offline HTML, approved controller start, and matching stage paint");
    const second = await browser.newContext();
    const other = await second.newPage();
    await signIn(other, "other-" + crypto.randomUUID() + "@example.test", password, true);
    assert.equal(await other.getByRole("link", { name: "November revenue" }).count(), 0);
    const denied = await second.request.get(api + "/api/sessions/" + session + "/research/" + state.research.research_id + "/context.md");
    assert.ok([401, 403, 404].includes(denied.status()));
    const preparationDenied = await second.request.get(preparationUrl);
    assert.ok([401, 403, 404].includes(preparationDenied.status()));
    await other.getByLabel("Project name").fill("Mixed units");
    await other.getByRole("button", { name: "New project" }).click();
    await other.getByRole("button", { name: /Public research allowed/ }).click();
    await pasteSource(other, "Revenue in January 2025: USD 1,200.\nRevenue in February 2025: EUR 1,500.");
    await other.getByLabel("Your message").fill("Review the reported revenue for the board. Ask them to approve the pilot.");
    await other.getByRole("button", { name: "Send", exact: true }).click();
    await other.getByRole("button", { name: "Start research", exact: true }).click();
    await other.getByRole("spinbutton", { name: "How many slides?", exact: true }).waitFor({ timeout: 45_000 });
    const mixedSession = new URL(other.url()).searchParams.get("project");
    const mixedWorkspace = await (await second.request.get(api + "/api/sessions/" + mixedSession + "/interview/workspace")).json();
    const mixedSource = await (await second.request.get(api + "/api/sessions/" + mixedSession + "/research/" + mixedWorkspace.research.research_id + "/context.md")).text();
    assert.match(mixedSource, /EUR/);
    assert.doesNotMatch(mixedSource, /<graph>/);
    console.log("PASS denied microphone to typed briefing, incomparable graph units withheld");
    console.log("PASS private project, desktop layout, files-only job, process restart, fresh-browser reopen, hidden private context SSE, chart data, cross-account denial");
  } finally { await browser.close(); }
} finally {
  await Promise.all([stop(next), stop(server)]);
  await rm(directory, { recursive: true, force: true });
}
