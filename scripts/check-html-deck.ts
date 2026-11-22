// Exercise the browser download path and inspect the actual standalone document.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import type { TDeck } from "../frontend/types/deck";

const screenshotPath = "/api/sessions/private-project-fixture/site-runs/private-run-fixture/steps/1/screenshot";
const deck: TDeck = {
  deck_id: "layout-fixture", research_id: "private-fixture", revision: 2, title: "Enterprise pilot",
  sources: [
    { id: "M1", origin: "public", location: "Pilot report", url: "https://www.example.com/pilot" },
    { id: "M2", origin: "material", location: "PRIVATE_UPLOAD_FILENAME.csv" },
    { id: "B1", origin: "material", location: "Walkthrough screenshot", url: "https://www.example.com/setup", image: screenshotPath },
  ],
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
    { slide_id: "f", layout: "evidence", title: "Enterprise is the largest trial segment", highlights: [], narration: "PRIVATE_AUDIO_F",
      evidence_ids: ["M1"], chart_period: "2025", template: { type: "donut_chart", unit: "%", points: [
        { label: "Enterprise", value: 46 }, { label: "Midmarket", value: 32 }, { label: "Small business", value: 22 },
      ] } },
    { slide_id: "g", layout: "evidence", title: "Create the pilot project", highlights: ["Open the project setup page."],
      narration: "PRIVATE_AUDIO_G", evidence_ids: ["B1"] },
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
const build = await Bun.build({
  entrypoints: ["frontend/lib/export-deck.ts"],
  target: "browser",
  format: "esm",
  define: { "process.env.NEXT_PUBLIC_API_URL": JSON.stringify("") },
});
assert.ok(build.success, build.logs.map(String).join("\n"));
const module_text = await build.outputs.find(output => output.path.endsWith(".js"))!.text();
const dir = await mkdtemp(join(tmpdir(), "html-deck-"));
try {
  const browser = await chromium.launch({ channel: process.env.DECK_BROWSER_CHANNEL || undefined });
  try {
    const page = await browser.newPage();
    const jpeg = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 36;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#23574b";
      context.fillRect(0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg").split(",")[1]!;
    });
    await page.route("http://deck.test/**", route => {
      if (new URL(route.request().url()).pathname === screenshotPath) {
        return route.fulfill({ contentType: "image/jpeg", body: Buffer.from(jpeg, "base64") });
      }
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
    for (const private_value of ["PRIVATE_AUDIO", "private-fixture", "PRIVATE_UPLOAD_FILENAME"]) {
      assert.ok(!html.includes(private_value), "Export leaked private material");
    }
    assert.ok(html.includes("Supplied material"), "Export should show the source category");
    assert.ok(html.includes("data:image/jpeg;base64," + jpeg), "Export should embed the screenshot bytes");
    assert.ok(!html.includes(screenshotPath), "Export leaked the private screenshot path");
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
      const bars = viewer.locator('[data-template="bar_chart"] .bar-mark');
      assert.equal(await bars.count(), 12);
      const barLengths = await bars.evaluateAll(marks => marks.map(mark => mark.getBoundingClientRect().width));
      assert.ok(Math.abs(barLengths.at(-1)! * 3 / 8 - barLengths[0]) < 1, "Positive and negative bars use different scales");
      assert.equal(await viewer.locator('[data-composition="visual"] .slide-points').count(), 0);
      assert.equal(await viewer.getByText("percentage points · FY2025/26", { exact: true }).count(), 1);
      assert.equal(await viewer.locator('[data-template="line_chart"] .line circle').count(), 2);
      assert.equal(await viewer.locator('[data-template="line_chart"][data-composition="mixed"] .slide-points li').count(), 1);
      const donut = viewer.locator('[data-template="donut_chart"]');
      assert.equal(await donut.locator("circle[pathLength='100']").count(), 3);
      assert.deepEqual(await donut.locator("dd").allTextContents(), ["46%", "32%", "22%"]);
      assert.equal(await donut.getByText("Source: example.com", { exact: true }).count(), 1);
      const screenshot = viewer.locator(".slide-screenshot");
      assert.equal(await screenshot.count(), 1);
      assert.equal(await screenshot.evaluate(async image => {
        if (!(image instanceof HTMLImageElement)) throw new Error("Expected an image element");
        await image.decode();
        return image.naturalWidth;
      }), 64);
      if (width >= 1000) assert.ok(sizes.heights.every(h => h <= height + 1), `Projector slide exceeds ${height}px: ${sizes.heights.join(", ")}`);
      console.log("PASS standalone HTML at " + width + "×" + height);
    }
    assert.equal(external, 0, "Standalone HTML depends on network resources");
  } finally { await browser.close(); }
} finally { await rm(dir, { recursive: true, force: true }); }
