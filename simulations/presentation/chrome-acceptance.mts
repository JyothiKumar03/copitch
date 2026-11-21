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

const usage = `node simulations/presentation/chrome-acceptance.mts [--strict-plans] [--software-exports]
  COPITCH_ACCEPT_WEB             Local web origin (default http://localhost:3000)
  COPITCH_ACCEPT_API             Optional local API origin (otherwise detected from the browser)
  COPITCH_ACCEPT_PLANNER_TRACE   Optional server log file collected with TRACE_LOGS=1
  COPITCH_ACCEPT_CHANNEL         Browser channel (default chrome, use bundled for Playwright Chromium)
  COPITCH_ACCEPT_SCREENSHOT      Optional path for the final preview screenshot
  COPITCH_ACCEPT_QUESTION_AUDIO  Optional recording of the week-three question to feed through Chrome's microphone
  COPITCH_ACCEPT_RELOAD_PREPARE  Set to 1 to reload after queueing the first deck
  COPITCH_ACCEPT_SOURCE_URLS     Optional newline-separated official sources for --software-exports
  --strict-plans                 Require independently accepted, distinct plans for two slide limits
`;

const notes = `My name is Mira Kade. I lead customer onboarding for small businesses on an operations team.
I designed a multilingual setup guide after customers said the previous steps were unclear. I coached two colleagues on using it.
Our team documented 24 completed setups in week three. We do not know whether the guide caused the result.
My current goal is to make onboarding easier for customers and improve how teammates document setup outcomes.`;
const softwareExports = process.argv.includes("--software-exports");
const exportsBrief = "Prepare an evidence-backed market research presentation for company leadership on India's software exports in the current FY 2026–27. Use official Indian government and central bank publications only. Distinguish the latest published software-services export period from the annual benchmark and broader all-services exports. Cover export value, available volume or measurement limits, technology or activity mix, and what the official evidence can establish about talent. Give citations, an explicit reporting period and comparable charts where supported. Show the plan for approval before starting.";
const officialPublisher = (hostname: string) => /(?:^|\.)(?:gov\.in|nic\.in|rbi\.org\.in)$/iu.test(hostname);
const approvedSources = process.env.COPITCH_ACCEPT_SOURCE_URLS?.split(/\r?\n/u).map(value => value.trim()).filter(Boolean) ?? [];

type TBriefing = { phase?: string; text: string; proposal?: { source_policy: string; urls: string[]; queries: string[] }; workspace: { job: { job_id: string } | null } };
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

const attachQuestionAudio = (page: Page, audio: Buffer) => page.evaluate(encoded => {
  const transport: { start?: () => void } = {};
  Object.assign(window, { rehearsalMicrophone: transport });
  navigator.mediaDevices.getUserMedia = async () => {
    const context = new AudioContext();
    const sink = context.createMediaStreamDestination();
    const source = context.createBufferSource();
    source.buffer = await context.decodeAudioData(Uint8Array.from(atob(encoded), character => character.charCodeAt(0)).buffer);
    source.connect(sink);
    await context.resume();
    transport.start = () => source.start();
    return sink.stream;
  };
}, audio.toString("base64"));
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

const readSavedResearch = async (page: Page, base: string, researchId: string) => {
  const response = await page.request.get(`${base}/research/${researchId}/context.md`);
  assert.ok(response.ok(), `Private research read: HTTP ${response.status()}`);
  const markdown = await response.text();
  if (softwareExports) {
    const publishers = [...markdown.matchAll(/^\[\^[A-Z]\d+\]:.*?<((?:https?):\/\/[^>]+)>/gmu)].map(([, url]) => new URL(url).hostname);
    assert.ok(new Set(publishers).size > 1 && publishers.every(officialPublisher), "Expected citations from multiple official publishers");
    assert.match(markdown, /(?:51[.,]384|51,384)\b/u, "Expected RBI's released software-services quarter");
    assert.match(markdown, /221\.4\b/u, "Expected RBI's separate annual software-services benchmark");
    assert.match(markdown, /259\.78\b/u, "Expected Commerce's separately labelled all-services figure");
  } else {
    assert.match(markdown, /(?:\b24\b[^.\n]{0,70}\bsetups?\b|\bsetups?\b[^.\n]{0,70}\b24\b)/iu);
    assert.match(markdown, /uncertain|unknown|do not know|does not (?:establish|show)|no evidence of causation|cannot (?:infer|conclude)/iu);
  }
  assert.doesNotMatch(markdown, /^## (?:Talk track|Speaker notes)\b/imu);
  return markdown;
};

const prepare = async (page: Page, limit: number, variant = false) => {
  if (variant) await page.getByRole("button", { name: "Change slide count", exact: true }).click();
  await page.getByRole("spinbutton", { name: /how many slides|slide count/iu }).fill(String(limit));
  const pending = observe(page.waitForResponse(response => postedTo(response, "/decks")));
  await page.getByRole("button", { name: "Generate slides", exact: true }).click();
  const response = await pending;
  assert.deepEqual(response.request().postDataJSON()?.pitch, { slide_count: limit });
  const deck = response.status() === 202 ? await (async () => {
    const posted = await checkJson<{ job_id: string }>(response, "Queue deck review");
    assert.ok(posted.job_id);
    if (!variant && process.env.COPITCH_ACCEPT_RELOAD_PREPARE === "1") {
      await page.waitForFunction(jobId => Object.values(sessionStorage).includes(jobId), posted.job_id);
      await page.reload();
    }
    return waitFor("completed deck review", async () => {
      const status = await page.request.get(`${response.url()}/preparations/${posted.job_id}`);
      assert.ok(status.ok(), `Read deck review: HTTP ${status.status()}`);
      const result = await status.json() as { status: string; deck?: TDeck; error?: string };
      if (result.status === "failed") throw Error(result.error ?? "Deck review failed");
      return result.status === "completed" ? result.deck : undefined;
    }, 240_000);
  })() : await checkJson<TDeck>(response, "Prepare deck");
  await page.getByRole("heading", { name: "Presentation preview" }).waitFor({ timeout: 30_000 }).catch(async error => {
    throw new Error(`${error.message}\n${(await page.locator("body").innerText()).slice(0, 1600)}`);
  });
  assert.ok(deck.slides.length > 0 && deck.slides.length <= limit);
  assert.equal(deck.render_review?.status, "passed");
  assert.ok(deck.render_review.rounds >= 1 && deck.render_review.rounds <= 3);
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
  const projectName = softwareExports ? "India software exports · official-source rehearsal" : "Synthetic onboarding introduction";
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
    await page.getByLabel("Project name").fill(projectName);
    await page.getByRole("button", { name: "New project" }).click();
    const paste = async (text: string) => {
      await page.evaluate(value => navigator.clipboard.writeText(value), text);
      await page.getByLabel("Your message").focus();
      await page.keyboard.press(process.platform === "darwin" ? "Meta+v" : "Control+v");
    };
    if (softwareExports) {
      for (const url of approvedSources) {
        assert.ok(officialPublisher(new URL(url).hostname));
        await paste(url);
        await page.getByRole("button", { name: `Remove ${url}`, exact: true }).waitFor();
      }
    } else {
      await paste(notes);
      await page.getByRole("button", { name: /Remove Pasted text/u }).waitFor();
      await page.getByRole("button", { name: /Public research allowed/u }).click();
      await page.getByRole("button", { name: "Apply sources" }).click();
      await page.getByRole("button", { name: "Apply sources" }).waitFor({ state: "hidden" });
    }

    let { briefing } = await sendStudio(page, softwareExports ? exportsBrief : "Prepare a two-minute personal introduction about me, Mira Kade, for my new operations teammates. Explain my onboarding work and how I record outcomes. This is informational. Use only my pasted notes and preserve the 24 completed setups and the uncertainty about cause.");
    if (briefing.phase !== "proposed") {
      ({ briefing } = await sendStudio(page, softwareExports ? "Show the official-sources-only research plan for our company leadership now." : "Show the files-only research plan now. Use the pasted material for an informational introduction to the new operations team."));
    }
    assert.equal(briefing.phase, "proposed", briefing.text);
    assert.equal(briefing.proposal?.source_policy, softwareExports ? "public_search" : "files_only");
    if (softwareExports) {
      assert.ok(approvedSources.every(url => briefing.proposal?.urls.includes(url)), "The plan omitted an attached official source");
      report("public_plan", { explicitSources: briefing.proposal?.urls.length, approvedQueries: briefing.proposal?.queries });
    }
    assert.equal(briefing.workspace.job, null);
    const started = await sendStudio(page);
    const jobId = started.briefing.workspace.job?.job_id;
    const projectUrl = page.url();
    const sessionId = new URL(projectUrl).searchParams.get("project");
    const api = explicitApi || started.api;
    assert.ok(jobId && sessionId);
    const base = `${api}/api/sessions/${sessionId}`;
    await page.getByRole("spinbutton", { name: /how many slides|slide count/iu }).or(page.getByRole("heading", { name: "More evidence needed" }))
      .or(page.getByRole("heading", { name: "Research could not finish" })).first().waitFor({ timeout: 180_000 });
    const jobResponse = await first.context.request.get(`${base}/research/jobs/${jobId}`);
    assert.ok(jobResponse.ok());
    const job = await jobResponse.json() as TResearchJob;
    assert.equal(job.status, "completed", job.error);
    if (softwareExports) assert.ok((job.read_pages ?? 0) > 1, "Broad market research read only one page");
    else {
      assert.equal(job.read_pages, 0);
      assert.equal(job.completed_lookups, 0);
    }
    const researchId = job.result?.research_id;
    assert.ok(researchId);
    const context = await readSavedResearch(page, base, researchId);
    await first.context.close();

    const returning = await signIn(false);
    const host = returning.page;
    await host.getByRole("link", { name: projectName }).click();
    assert.equal(host.url(), projectUrl);
    assert.equal(await readSavedResearch(host, base, researchId), context);
    assert.equal(await host.getByRole("button", { name: "context.md", exact: true }).count(), 0);
    report("context_reopened", { bytes: Buffer.byteLength(context), pages: job.read_pages, passes: job.research_passes,
      toolSteps: job.tool_steps, ...(softwareExports ? { case: "software_exports" } : { metric: 24 }) });

    await host.getByLabel("Private conversation").getByRole("spinbutton", { name: /how many slides|slide count/iu }).waitFor();
    assert.equal(await host.getByRole("heading", { name: "Prepare your presentation", exact: true }).count(), 0);
    assert.equal(await host.getByText("Walkthrough URL", { exact: true }).count(), 0);
    const primary = await prepare(host, 2);
    assert.equal(primary.research_id, job.result?.research_id);
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
    const questionAudio = softwareExports ? undefined : process.env.COPITCH_ACCEPT_QUESTION_AUDIO;
    if (questionAudio) await attachQuestionAudio(host, await readFile(questionAudio));
    const audio = observe(host.waitForResponse(response => response.url().includes("/live/audio/") && response.ok(), { timeout: 55_000 }));
    await host.getByRole("button", { name: "Approve and present", exact: true }).click();
    assert.match((await audio).headers()["content-type"], /^audio\/mpeg/u);
    await waitFor("host playing acknowledgement", () => playback.find(event => event.action.kind === "playing"));
    const stage = host.getByLabel("Live presentation controls").locator(".slide-shell");
    await stage.waitFor();
    const stageText = await stage.innerText();
    assert.ok(primary.slides.some(slide => stageText.includes(slide.title)));
    assert.equal(await returning.context.pages().length, 1);
    report("live_deck_opened", { titles: primary.slides.map(slide => slide.title), hostAudio: true, hostStage: true, privateSafeHtml: true });

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
    await waitFor("host stage narration", async () => {
      const state = await liveState();
      return state.painted && state.attempt?.kind === "narration" && playback.some(event =>
        event.action.kind === "playing" && event.action.attempt_id === state.attempt?.attempt_id);
    });
    if (softwareExports) {
      const paused = await command("Pause", "pause");
      assert.equal(paused.status, "paused");
      await command("Resume", "resume");
      report("market_presentation_paused_and_resumed", { slide: paused.cursor.slide_id, sentence: paused.cursor.sentence_index, researchId: primary.research_id });
      return;
    }
    const interrupted = observe(host.waitForResponse(response => postedTo(response, "/live/commands") &&
      response.request().postDataJSON()?.action?.kind === "interrupt"));
    const answered = questionAudio ? await (async () => {
      await host.getByText("Speak to interrupt", { exact: true }).waitFor();
      const pending = observe(host.waitForResponse(response => postedTo(response, "/live/turns")));
      const transcription = observe(host.waitForResponse(response => postedTo(response, "/interview/transcribe")));
      await host.evaluate(() => (window as Window & { rehearsalMicrophone: { start: () => void } }).rehearsalMicrophone.start());
      const clip = await checkJson<{ text: string }>(await transcription, "Transcribe spoken question");
      assert.match(clip.text, /completed setups/iu);
      return checkJson<TPresentationState>(await pending, "Spoken question");
    })() : await ask("How many completed setups did the team document in week three?");
    const { pin } = await checkJson<TPresentationState>(await interrupted, "Interrupt from typed question");
    assert.ok(pin);
    assert.equal(answered.last_reply?.kind, "answer");
    assert.match(answered.last_reply.text, /24|twenty.four/iu);
    assert.ok(answered.last_reply.evidence_ids.length);
    assert.equal(answered.attempt?.kind, "answer");
    const resumed = await waitFor("spoken answer and resume", () => playback.find(event =>
      event.action.kind === "ended" && event.action.attempt_id === answered.attempt?.attempt_id));
    assert.deepEqual(resumed.state.cursor, { slide_id: pin.slide_id, sentence_index: pin.sentence_index });
    report("cited_answer_resumed", { sentence: pin.sentence_index, citations: answered.last_reply.evidence_ids.length, input: questionAudio ? "recorded_audio" : "text" });

    const opening = primary.slides[0];
    assert.equal(await host.getByLabel("Go to slide").count(), 0);
    if ((await liveState()).cursor.slide_id !== opening.slide_id) await command("Back", "back");
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
    assert.ok(draft.proposal.before.highlights.every(highlight => draft.proposal?.after.highlights.includes(highlight)));
    assert.ok(draft.proposal.after.narration.startsWith(draft.proposal.before.narration));
    assert.equal(await stage.getByText(draftHighlight, { exact: true }).count(), 0);
    const rejected = await command("Keep current slide", "decide");
    assert.equal(rejected.revision, draft.revision);
    assert.deepEqual(rejected.cursor, draft.cursor);
    assert.equal(rejected.status, "paused");

    const repeated = await ask("A new fact from me: I review common onboarding questions with teammates on Mondays. Add that fact as a visible highlight and use the exact sentence ‘I review common onboarding questions with teammates on Mondays.’ as a standalone narration sentence. Attribute both to me.");
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
    const secondary = await prepare(host, 1, true);
    assert.notEqual(primary.deck_id, secondary.deck_id);
    assert.equal(primary.research_id, secondary.research_id);
    const publicAndSpoken = (deck: TDeck) => deck.slides.map(({ title, highlights, template, narration }) => ({ title, highlights, template, narration }));
    const distinctContent = JSON.stringify(publicAndSpoken(primary)) !== JSON.stringify(publicAndSpoken(secondary));
    const secondOutcomes = (await plannerOutcomes(primary.research_id)).slice(firstOutcomes.length);
    const plans = [firstOutcomes, secondOutcomes].map((attempts, index) => ({ slideLimit: index ? 1 : 2,
      outcome: attempts.at(-1) ?? "unobserved", attempts }));
    const anyVerified = plans.some(plan => plan.outcome === "accepted" || plan.outcome === "accepted_verified_subset");
    const independent = plans.every(plan => plan.outcome === "accepted") ? "accepted" : anyVerified ? "partial" :
      plans.every(plan => plan.outcome !== "unobserved") ? "rejected" : "unobserved";
    report("slide_count_planning", { researchId: primary.research_id, browser: "passed", distinctContent, independent, plans,
      adaptation: independent === "accepted" && distinctContent ? "verified" : distinctContent ? "partial" : "unverified",
      titles: [primary.slides.map(slide => slide.title), secondary.slides.map(slide => slide.title)] });
    const screenshot = process.env.COPITCH_ACCEPT_SCREENSHOT;
    if (screenshot) await host.screenshot({ path: screenshot });
    if (process.argv.includes("--strict-plans")) assert.ok(independent === "accepted" && distinctContent, "Both slide-limit plans must pass independent verification and differ");
  } finally { await browser.close(); }
};

if (process.argv.includes("--help")) console.log(usage);
else rehearse().catch(error => { console.error(error); process.exitCode = 1; });
