import PptxGenJS from "pptxgenjs";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { z } from "zod";
import type { TWebsiteCaptureAttempt, TWebsiteWalkthroughPage } from "../../../shared/website-walkthrough";
import { configured_models_for } from "./model-config";
import { website_walkthrough_plan } from "./prompts";

type TCaptureSlide = TWebsiteWalkthroughPage & { screenshot: Buffer; caption?: string; evidence_id?: string };
type TWebsiteDeck = { url: string; audience: string; goal: string; pages: TCaptureSlide[]; attempts: TWebsiteCaptureAttempt[]; coverage?: { visited: number; blocked: number; remaining: number } };
const ink = "17251C";
const paper = "F5F5EC";
const greens = { deep: "182D20", mid: "44634B", light: "DCF0D2" };
const evidence = "794E19";
const note_length = 240;
const sentences = new Intl.Segmenter(undefined, { granularity: "sentence" });
const words = new Intl.Segmenter(undefined, { granularity: "word" });
const statement_end = /[.!。！]["'’”»)\]]*$/u;
const navigation_marks = />>|(?:^|\s)[›»](?:\s|$)|(?:[^|]+\|){2}/u;
const dependent_opening = /^(?:if not|if so|otherwise|as mentioned|see also)\b/iu;
const normal_text = (text: string) => [...text].filter(char => char >= " " || char === "\n").join("").replace(/\s+/gu, " ").trim();
const clean = (text: string, length: number) => {
  const normalized = normal_text(text);
  if (normalized.length <= length) return normalized;
  return normalized.slice(0, length - 1).trimEnd() + "…";
};

const excerpt = (text: string) => {
  if (text.length <= note_length) return text;
  let end = 0;
  for (const { index, segment, isWordLike } of words.segment(text)) {
    if (index + segment.length >= note_length) break;
    if (isWordLike) end = index + segment.length;
  }
  return end ? text.slice(0, end) + "…" : "";
};

const selected_facts = (facts: string[], goal: string, audience: string) => {
  const tokens = (text: string) => new Set(text.toLowerCase().match(/\p{L}{4,}/gu) ?? []);
  const terms = tokens(goal + " " + audience);
  return facts
    .map(text => ({ text, matches: [...tokens(text)].filter(term => terms.has(term)).length }))
    .sort((left, right) => Number(statement_end.test(right.text)) - Number(statement_end.test(left.text)) ||
      right.matches - left.matches).slice(0, 3).map(item => item.text);
};

const page_facts = (page: TCaptureSlide) => {
  const comparable = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/gu, " ").trim();
  const headings = new Set([page.title, ...page.title.split(/\s+[|–—-]\s+/u)].map(comparable));
  return [...new Set(page.facts.flatMap(source => {
    const text = normal_text(source);
    if (headings.has(comparable(text)) || navigation_marks.test(text)) return [];
    const useful = [...sentences.segment(text)].map(({ segment }) => segment.trim()).filter(line =>
      !dependent_opening.test(line) && [...words.segment(line)].filter(word => word.isWordLike).length >= 5);
    const statements = useful.filter(line => statement_end.test(line));
    // A page can expose an excerpt or an unpunctuated list item. Keep enough context to distinguish prose from a label.
    const candidates = statements.length ? statements : useful.filter(line => line.length >= 100 && !/[?？]["'’”»)]*$/u.test(line));
    return candidates.map(excerpt).filter(Boolean);
  }))];
};

const image_frame = (x: number, y: number, w: number, h: number) => {
  const capture_aspect = 1440 / 900;
  const width = Math.min(w, h * capture_aspect);
  const height = width / capture_aspect;
  return { x: x + (w - width) / 2, y: y + (h - height) / 2, w: width, h: height };
};

const story_schema = z.strictObject({
  pages: z.array(z.strictObject({ capture_id: z.number().int().positive(), fact_indexes: z.array(z.number().int().nonnegative()).max(3) })).min(1),
});

const select_story = async (pages: TCaptureSlide[], audience: string, goal: string, signal?: AbortSignal) => {
  const [model] = signal ? configured_models_for("planning") : [];
  if (!signal || !model || !process.env.OPENAI_API_KEY) return;
  try {
    const { output } = await generateText({
      model: createOpenAI().responses(model.model),
      instructions: website_walkthrough_plan,
      prompt: JSON.stringify({ audience, goal, pages: pages.map(({ capture_id, url, title, facts }) => ({ capture_id, url, title, facts })) }),
      output: Output.object({ schema: story_schema }),
      providerOptions: { openai: { store: false } },
      maxOutputTokens: Math.min(model.max_output_tokens, 1500),
      maxRetries: 0, abortSignal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
    });
    const by_id = new Map(pages.map(page => [page.capture_id, page]));
    if (new Set(output.pages.map(item => item.capture_id)).size !== output.pages.length) return;
    const selection = [];
    for (const { capture_id, fact_indexes } of output.pages) {
      const page = by_id.get(capture_id);
      if (!page || fact_indexes.some(index => index >= page.facts.length)) return;
      selection.push({ ...page, facts: [...new Set(fact_indexes)].map(index => page.facts[index]) });
    }
    return selection;
  } catch {
    signal.throwIfAborted();
    if (process.env.TRACE_LOGS === "1") console.log(JSON.stringify({ operation: "website.story", outcome: "captured_order" }));
  }
};

// Site titles usually repeat the site name ("Projects — Jane Doe"). Drop a suffix every page shares.
const shared_title_suffix = (titles: string[]) => {
  const suffixes = titles.map(title => title.match(/\s+[|–—-]\s+([^|–—-]+)$/u)?.[1]);
  const first = suffixes[0];
  return titles.length > 1 && first && suffixes.every(suffix => suffix === first) ? first : undefined;
};

export const export_website_powerpoint = async ({ url, audience, goal, pages, attempts, coverage }: TWebsiteDeck, signal?: AbortSignal) => {
  signal?.throwIfAborted();
  const suffix = shared_title_suffix(pages.map(page => page.title));
  const page_title = (title: string) => suffix ? title.replace(new RegExp(`\\s+[|–—-]\\s+${RegExp.escape(suffix)}$`, "u"), "") : title;
  const readable_pages = pages.map(page => ({ ...page, facts: page.caption ? page.facts : page_facts(page) }));
  const planned = await select_story(readable_pages, audience, goal, signal);
  const story = planned ?? readable_pages;
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = clean(pages[0].title, 130) + " product walkthrough";
  pptx.subject = "Website walkthrough";
  pptx.author = "copitch";
  pptx.theme = { headFontFace: "Aptos Display", bodyFontFace: "Aptos" };
  const fields = { margin: 0, fontFace: "Aptos", color: ink, breakLine: false };
  const cover = pptx.addSlide();
  cover.background = { color: greens.deep };
  cover.addText("PRODUCT WALKTHROUGH", { ...fields, x: .57, y: .53, w: 5.2, h: .34, bold: true, fontSize: 14, color: greens.light, charSpacing: 2 });
  cover.addText(clean(pages[0].title || new URL(url).hostname, 100), {
    ...fields, x: .57, y: 1.16, w: 5.1, h: 1.93, fontSize: 41, bold: true, color: paper, valign: "middle", fit: "shrink",
  });
  const opener = selected_facts(readable_pages[0].facts, goal, audience)[0];
  if (opener) cover.addText(opener, { ...fields, x: .59, y: 3.40, w: 4.7, h: 1.56,
    fontSize: 21, color: paper, valign: "top", fit: "shrink" });
  cover.addText(`${story.length} captured ${story.length === 1 ? "page" : "pages"}`,
    { ...fields, x: .59, y: 5.55, w: 4.7, h: .54, fontSize: 15, color: greens.light, fit: "shrink" });
  cover.addText(new URL(url).hostname, { ...fields, x: .59, y: 6.68, w: 4.7, h: .3, fontSize: 13, color: greens.light, hyperlink: { url } });
  const intro_image = "image/jpeg;base64," + pages[0].screenshot.toString("base64");
  cover.addImage({ data: intro_image, ...image_frame(5.98, 1.33, 6.78, 4.94),
    altText: "Screenshot of " + clean(pages[0].title, 90) });

  for (const page of story) {
    const slide = pptx.addSlide();
    slide.background = { color: paper };
    slide.addText(clean(page.caption ? `${page.capture_id}. ${page_title(page.title)}` : page_title(page.title), 105), { ...fields, x: .55, y: .49, w: 12.25, h: .90,
      fontFace: "Aptos Display", fontSize: 34, bold: true, valign: "middle", fit: "shrink" });
    const image = "image/jpeg;base64," + page.screenshot.toString("base64");
    slide.addImage({ data: image, ...image_frame(.55, 1.60, 8.24, 5.22),
      altText: "Captured page for " + clean(page.title, 90) });
    const facts = page.caption ? page.facts.filter(fact => !page.title.startsWith(fact)).slice(0, 2)
      : planned ? page.facts : selected_facts(page.facts, goal, audience);
    if (page.caption) slide.addNotes([page.caption, ...page.facts, page.evidence_id ?? "", page.url].join("\n"));
    if (facts.length) {
      slide.addText(page.caption ? clean(page.caption, 90) : "What the page shows", { ...fields, x: 9.23, y: 1.76, w: 3.45, h: .46, fontSize: 18, bold: true, color: greens.mid });
      for (const [index, fact] of facts.entries()) slide.addText(fact, { ...fields, x: 9.23, y: 2.38 + index * 1.18,
        w: 3.45, h: 1.08, fontSize: 16, valign: "top", fit: "shrink" });
    }
    slide.addText(page.evidence_id ? `Open the captured page · ${page.evidence_id}` : "Open the captured page", { ...fields, x: .55, y: 6.99, w: 6.5, h: .27, fontSize: 12,
      color: evidence, hyperlink: { url: page.url, tooltip: page.url } });
  }

  // A path captured from another address of the same site (for example www) is not a gap.
  const captured_paths = new Set(attempts.filter(attempt => attempt.status === "captured").map(attempt => new URL(attempt.observed_url ?? attempt.url).pathname));
  const failed = attempts.filter(attempt => attempt.status === "failed" && !captured_paths.has(new URL(attempt.url).pathname));
  if (failed.length || coverage) {
    const slide = pptx.addSlide();
    slide.background = { color: paper };
    slide.addText(coverage ? "Walkthrough coverage" : "Pages we could not capture", { ...fields, x: .55, y: .55, w: 12.2, h: .75, fontSize: 33, bold: true });
    if (coverage) slide.addText(`${coverage.visited} pages visited · ${coverage.blocked} blocked paths · ${coverage.remaining} paths remaining`,
      { ...fields, x: .59, y: 1.25, w: 12.1, h: .46, fontSize: 17, color: greens.mid });
    for (const [index, attempt] of failed.slice(0, 8).entries()) {
      const y = (coverage ? 1.94 : 1.52) + index * .68;
      slide.addText(clean(attempt.url, 118), { ...fields, x: .59, y, w: 6.6, h: .58, fontSize: 13, color: evidence, fit: "shrink" });
      slide.addText(clean(attempt.reason ?? "The page was unavailable.", 125), { ...fields, x: 7.35, y, w: 5.3, h: .58, fontSize: 14, fit: "shrink" });
    }
  }
  const output = await pptx.write({ outputType: "nodebuffer", compression: true });
  if (!(output instanceof Uint8Array)) throw new Error("PowerPoint export returned an unexpected format.");
  return Buffer.from(output);
};
