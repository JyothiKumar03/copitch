// Exercise the browser download path and inspect the actual standalone document.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import type { TDeck } from "../frontend/types/deck";

const deck: TDeck = {
  deck_id: "layout-fixture", research_id: "private-fixture", revision: 2, title: "Enterprise pilot",
  slides: [
    { slide_id: "a", layout: "headline", title: "Start the pilot with enterprise buyers",
      highlights: ["The first cohort gives us a focused place to test onboarding."], narration: "PRIVATE_AUDIO_A", evidence_ids: ["M1"] },
    { slide_id: "b", layout: "evidence", title: "Enterprise conversion reached 20%",
      highlights: ["4 of 20 enterprise trials converted.", "Across the full sample, 10 of 100 converted."], narration: "PRIVATE_AUDIO_B", evidence_ids: ["M1", "M2"] },
    { slide_id: "c", layout: "takeaway", title: "Review setup before expanding <the pilot>",
      highlights: ["Check the first-run experience.", "Compare the next cohort against the same denominator."], narration: "PRIVATE_AUDIO_C", evidence_ids: ["M1"] },
    { slide_id: "d", layout: "evidence", title: "Conversion changed by cohort", highlights: [], narration: "PRIVATE_AUDIO_D",
      evidence_ids: ["M1"], chart_period: "FY2025/26", template: { type: "bar_chart", unit: "percentage points", points: Array.from({ length: 12 }, (_, i) => ({ label: `Cohort ${i + 1}`, value: i - 3 })) } },
    { slide_id: "e", layout: "evidence", title: "Paid orders rose in February", highlights: ["Track repeat orders next."],
      narration: "PRIVATE_AUDIO_E", evidence_ids: ["M2"], template: { type: "line_chart", unit: "orders", points: [{ label: "January", value: 14 }, { label: "February", value: 20 }] } },
  ],
};
// Exercise the accepted limits for host-authored copy, including four full-length highlight rows.
const long_phrase = "Compare each cohort against its baseline and preserve the original denominator. ";
deck.slides.push({
  slide_id: "stress", layout: "evidence",
  title: ("Measurement qualifications for the approved enterprise pilot and its follow-up evaluation ").repeat(2).slice(0, 160),
  highlights: Array.from({ length: 4 }, (_, index) => (String(index + 1) + ". " + long_phrase.repeat(4)).slice(0, 240).trimEnd()),
  narration: "PRIVATE_AUDIO_D", evidence_ids: ["M1", "M2"],
});
const build = await Bun.build({ entrypoints: ["frontend/lib/export-deck.ts"], target: "browser", format: "esm" });
assert.ok(build.success, build.logs.map(String).join("\n"));
const module_text = await build.outputs.find(output => output.path.endsWith(".js"))!.text();
const dir = await mkdtemp(join(tmpdir(), "html-deck-"));
try {
  const browser = await chromium.launch({ channel: process.env.DECK_BROWSER_CHANNEL || undefined });
  try {
    const page = await browser.newPage();
    await page.route("http://deck.test/**", route => {
      if (new URL(route.request().url()).pathname === "/export.js") {
        return route.fulfill({ contentType: "application/javascript", body: module_text });
      }
      return route.fulfill({ contentType: "text/html", body: '<button>Download</button><script type="module">import {exportDeck} from "/export.js"; document.querySelector("button").onclick=()=>exportDeck(window.deck);</script>' });
    });
    await page.addInitScript(value => { Object.assign(window, { deck: value }); }, deck);
    await page.goto("http://deck.test/");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByText("Download", { exact: true }).click()]);
    const file = join(dir, "presentation.html");
    await download.saveAs(file);
    const html = await readFile(file, "utf8");
    assert.ok(!html.includes("PRIVATE_AUDIO") && !html.includes("private-fixture"), "Export leaked private material");
    let external = 0;
    const offline = await browser.newContext();
    await offline.route(/^https?:/, route => { external++; return route.abort(); });
    const viewer = await offline.newPage();
    for (const [width, height] of [[1280, 720], [1440, 900], [390, 844]]) {
      await viewer.setViewportSize({ width, height });
      await viewer.goto(new URL("file://" + file).href);
      for (const slide of deck.slides) {
        const title = viewer.getByRole("heading", { name: slide.title, exact: true });
        assert.equal(await title.count(), 1);
        await title.scrollIntoViewIfNeeded();
        for (const highlight of slide.highlights) assert.equal(await viewer.getByText(highlight, { exact: true }).count(), 1);
        const rect = await title.boundingBox();
        assert.ok(rect && rect.x >= -1 && rect.x + rect.width <= width + 1, "Heading exceeds stage width");
      }
      const sizes = await viewer.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        heights: [...document.querySelectorAll("section")].map(s => s.getBoundingClientRect().height),
        clipping: [...document.querySelectorAll("h1,h2,h3,li,footer")].some(el => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === "hidden"),
      }));
      assert.ok(sizes.width <= width + 1 && !sizes.clipping, "Content overflow at width " + width);
      assert.ok(sizes.heights.length >= deck.slides.length, "Missing slide sections");
      assert.equal(await viewer.locator('[data-composition="visual"] .template-chart-mark').count(), 12);
      assert.equal(await viewer.locator('[data-composition="visual"] .slide-points').count(), 0);
      assert.equal(await viewer.getByText("percentage points · FY2025/26", { exact: true }).count(), 1);
      assert.equal(await viewer.locator('[data-composition="mixed"] svg circle').count(), 2);
      assert.equal(await viewer.locator('[data-composition="mixed"] .slide-points li').count(), 1);
      if (width >= 1000) assert.ok(sizes.heights.every(h => h <= height + 1), `Projector slide exceeds ${height}px: ${sizes.heights.join(", ")}`);
      console.log("PASS standalone HTML at " + width + "×" + height);
    }
    assert.equal(external, 0, "Standalone HTML depends on network resources");
  } finally { await browser.close(); }
} finally { await rm(dir, { recursive: true, force: true }); }
