import { chromium } from "playwright";
import type { Browser } from "playwright";
import { z } from "zod";
import { AppError } from "../errors/app-error";
import type { TDeck, TDeckLayoutIssue } from "../types/deck";
import { publicSourceLabels as public_source_labels } from "../../../shared/presentation";

export const visual_issue = z.enum(["overflow", "collision", "unreadable_text", "visual_hierarchy", "chart_legibility"]);
export const layout_issue = z.strictObject({
  slide_id: z.string().min(1).max(128), issue: visual_issue,
  viewport: z.string().max(64).optional(), note: z.string().max(280).optional(),
});

type TDeckRender = { issues: TDeckLayoutIssue[]; screenshot: Buffer };
let browser: Promise<Browser> | undefined;
let active_reviews = 0;

const render_page = () => new URL("/deck-render-check", process.env.DECK_RENDER_ORIGIN ??
  process.env.CORS_ORIGIN ?? "http://localhost:3000");

const shared_browser = () => {
  browser ??= chromium.launch({
    ...(process.env.DECK_RENDER_CHROMIUM
      ? { executablePath: process.env.DECK_RENDER_CHROMIUM }
      : { channel: "chrome" }),
    env: Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined &&
      ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "USER", "DISPLAY"].includes(key))),
    args: ["--disable-dev-shm-usage"], timeout: 10_000,
  }).then(running => {
    running.once("disconnected", () => { browser = undefined; });
    return running;
  }).catch(error => { browser = undefined; throw error; });
  return browser;
};

export const render_deck = async (deck: TDeck, signal?: AbortSignal): Promise<TDeckRender> => {
  signal?.throwIfAborted();
  if (active_reviews >= 2) throw new AppError(503, "The slide renderer is busy. Try again shortly.");
  active_reviews++;
  try {
    const address = render_page();
    const session = await (await shared_browser()).newContext({
      viewport: { width: 1280, height: 960 }, serviceWorkers: "block",
    });
    const stop = () => { void session.close().catch(() => undefined); };
    try {
      signal?.addEventListener("abort", stop, { once: true });
      signal?.throwIfAborted();
      await session.route("**/*", route => {
        const url = new URL(route.request().url());
        return url.origin === address.origin && (url.pathname === address.pathname || url.pathname.startsWith("/_next/"))
          ? route.continue() : route.abort();
      });
      const page = await session.newPage();
      const response = await page.goto(address.href, { waitUntil: "domcontentloaded", timeout: 15_000 });
      if (!response?.ok() || new URL(page.url()).origin !== address.origin) throw new Error("Slide render page unavailable");
      const views = deck.slides.map(({ slide_id, layout, title, highlights, evidence_ids, chart, chart_period, template }, index) => ({
        deckTitle: deck.title, index, total: deck.slides.length, sources: public_source_labels(deck.sources, evidence_ids),
        slide: { slide_id, layout, title, highlights, evidence_ids, chart, chart_period, template },
      }));
      await page.waitForFunction(() => "setDeckRenderViews" in globalThis, undefined, { timeout: 8_000 });
      await page.evaluate(input => {
        const render = (globalThis as typeof globalThis & { setDeckRenderViews: (data: typeof input) => void }).setDeckRenderViews;
        render(input);
      }, views);
      const report = page.locator("[data-deck-render-report]");
      const raw = await report.getAttribute("data-deck-render-report", { timeout: 8_000 });
      const issues = z.array(layout_issue).max(36).parse(JSON.parse(raw ?? "null"));
      const valid = new Set(views.map(view => view.slide.slide_id));
      if (await page.locator("[data-render-slide]").count() !== views.length || issues.some(issue => !valid.has(issue.slide_id))) {
        throw new Error("Incomplete slide render");
      }
      const screenshot = await report.screenshot({ type: "jpeg", quality: 85, timeout: 8_000 });
      return { issues, screenshot };
    } finally {
      signal?.removeEventListener("abort", stop);
      await session.close();
    }
  } catch (error) {
    signal?.throwIfAborted();
    if (process.env.TRACE_LOGS === "1") console.log(JSON.stringify({ operation: "presentation.render_failure",
      error_kind: error instanceof Error ? error.name : "unknown" }));
    throw new AppError(503, "The slide renderer is unavailable. Try again shortly.");
  } finally { active_reviews--; }
};
