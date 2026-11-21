import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";

const directory = await mkdtemp(join(tmpdir(), "copitch-studio-check-"));
const apiPort = Number(process.env.STUDIO_CHECK_API_PORT || 3191);
const webPort = Number(process.env.STUDIO_CHECK_WEB_PORT || 3190);
const api = "http://127.0.0.1:" + apiPort;
const web = "http://127.0.0.1:" + webPort;
const env = { ...process.env, NODE_ENV: "development", OPENAI_API_KEY: "", CORS_ORIGIN: web, NEXT_PUBLIC_API_URL: api, NEXT_TELEMETRY_DISABLED: "1" };
const startApi = () => spawn("bun", ["backend/tests/fixtures/studio-api.ts", join(directory, "check.sqlite"), String(apiPort), web], { env, stdio: ["ignore", "ignore", "inherit"] });
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
  await exited;
};
let server = startApi();
const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(webPort)], { cwd: "frontend", env, stdio: ["ignore", "ignore", "inherit"] });
try {
  await Promise.all([ready(api + "/api/health", server), ready(web + "/research", next)]);
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
    const streamed = reopened.waitForResponse(response => response.url().endsWith("/context.md") &&
      response.request().headers().accept === "text/event-stream");
    await reopened.getByRole("button", { name: "context.md", exact: true }).click({ timeout: 45000 });
    const contextResponse = await streamed;
    assert.equal(contextResponse.status(), 200);
    assert.match(contextResponse.headers()["content-type"], /^text\/event-stream/);
    const artifact = reopened.getByRole("article", { name: "Context document" });
    await artifact.getByRole("figure").waitFor();
    await artifact.getByText("Chart data and sources").click();
    const values = await artifact.getByRole("table").innerText();
    assert.match(values, /January 2025/);
    assert.match(values, /1,?200/);
    assert.match(values, /1,?500/);
    await artifact.getByRole("button", { name: "Markdown", exact: true }).click();
    const source = await artifact.getByLabel("Markdown source").textContent();
    assert.ok(source);
    assert.match(source, /<graph>[^\n]*<\/graph>/);
    assert.doesNotMatch(source, /^## (?:Talk track|Speaker notes)\b/im);
    const download = reopened.waitForEvent("download");
    await artifact.getByRole("button", { name: "Download context.md" }).click();
    const file = await (await download).path();
    assert.ok(file);
    assert.deepEqual(await readFile(file), Buffer.from(source));
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
    for (let index = 0; index < 20; index++) {
      const before = performance.now();
      const response = await returning.request.get(artifactUrl);
      assert.equal(await response.text(), source);
      reads.push(performance.now() - before);
    }
    reads.sort((a, b) => a - b);
    console.log("Local authenticated Markdown read, 20 warm samples (ms):", { p50: reads[9].toFixed(1), p95: reads[18].toFixed(1) });
    await reopened.getByRole("button", { name: "Close artifact" }).click();
    await reopened.getByText("Presentation options", { exact: true }).click();
    await reopened.getByRole("button", { name: "Prepare slides", exact: true }).click();
    await reopened.getByRole("heading", { name: "Presentation preview" }).waitFor();
    await reopened.getByRole("heading", { name: "Private narration" }).waitFor();
    const deckDownload = reopened.waitForEvent("download");
    await reopened.getByRole("button", { name: "Download offline slides" }).click();
    const deckFile = await (await deckDownload).path();
    assert.ok(deckFile);
    const deckHtml = await readFile(deckFile, "utf8");
    assert.match(deckHtml, /slide-shell/);
    assert.doesNotMatch(deckHtml, /Private narration|<script\b/i);
    const painted = reopened.waitForResponse(response => response.url().endsWith("/api/audience/paint") && response.status() === 204);
    await reopened.getByRole("button", { name: "Approve and present" }).click();
    await reopened.getByRole("heading", { name: "Live presentation" }).waitFor();
    await painted;
    await reopened.getByRole("button", { name: "Exit live view" }).click();
    await reopened.getByRole("heading", { name: "Presentation preview" }).waitFor();
    console.log("PASS signed-in context to deck review, private narration, offline HTML, approved controller start, and matching stage paint");
    const second = await browser.newContext();
    const other = await second.newPage();
    await signIn(other, "other-" + crypto.randomUUID() + "@example.test", password, true);
    assert.equal(await other.getByRole("link", { name: "November revenue" }).count(), 0);
    const denied = await second.request.get(api + "/api/sessions/" + session + "/research/" + state.research.research_id + "/context.md");
    assert.ok([401, 403, 404].includes(denied.status()));
    await other.getByLabel("Project name").fill("Mixed units");
    await other.getByRole("button", { name: "New project" }).click();
    await other.getByRole("button", { name: /Public research allowed/ }).click();
    await pasteSource(other, "Revenue in January 2025: USD 1,200.\nRevenue in February 2025: EUR 1,500.");
    await other.getByLabel("Your message").fill("Review the reported revenue for the board. Ask them to approve the pilot.");
    await other.getByRole("button", { name: "Send", exact: true }).click();
    await other.getByRole("button", { name: "Start research", exact: true }).click();
    await other.getByRole("button", { name: "context.md", exact: true }).click();
    const mixed = other.getByRole("article", { name: "Context document" });
    await mixed.getByRole("button", { name: "Markdown", exact: true }).click();
    const mixedSource = await mixed.getByLabel("Markdown source").innerText();
    assert.match(mixedSource, /EUR/);
    assert.doesNotMatch(mixedSource, /<graph>/);
    console.log("PASS denied microphone to typed briefing, incomparable graph units withheld");
    console.log("PASS private project, desktop layout, files-only job, process restart, fresh-browser reopen, context SSE, chart data, exact Markdown download, cross-account denial");
  } finally { await browser.close(); }
} finally {
  await Promise.all([stop(next), stop(server)]);
  await rm(directory, { recursive: true, force: true });
}
