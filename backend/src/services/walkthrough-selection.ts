import { createHash } from "node:crypto";
import PptxGenJS from "pptxgenjs";
import { z } from "zod";
import { planWalkthroughSelection } from "../../../shared/walkthrough-selection";
import type { TWalkthroughSelectionSlide, TWalkthroughSelectionCatalog, TWalkthroughSelectionInput, TWalkthroughSelectionItem, TWalkthroughSelectionKind } from "../../../shared/walkthrough-selection";
import type { SessionStore } from "../repositories/session";
import type { TWalkthroughExportScope } from "../repositories/walkthrough-export";
import { AppError } from "../errors/app-error";

export const selection_input = z.strictObject({
  approved: z.literal(true), request_id: z.uuid(), source_revision: z.string().regex(/^[a-f0-9]{64}$/u),
  item_ids: z.array(z.string().min(1).max(160)).max(350),
  host_additions: z.array(z.string().min(1).max(2000).refine(text => !!text.trim() && !/[\p{Cc}]/u.test(text.replace(/[\r\n\t]/gu, "")))).max(10),
}).refine(input => input.item_ids.length + input.host_additions.length > 0 &&
  new Set(input.item_ids).size === input.item_ids.length && input.host_additions.join("").length <= 8000);

type TPage = { n: number; title: string; url: string; facts: string[]; caption?: string };
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const capture = (db: SessionStore, scope: TWalkthroughExportScope): { pages: TPage[]; archived: boolean } => {
  if (scope.kind === "site-runs") {
    const run = db.site_runs.get(scope.session, scope.capture);
    if (!run) throw new AppError(404, "Walkthrough unavailable.");
    if (run.status === "running" || run.status === "queued" || !run.steps.length) throw new AppError(409, "Finish the walkthrough before selecting content.");
    return { pages: run.steps, archived: run.has_powerpoint };
  }
  const job = db.website_walkthroughs.get(scope.session, scope.capture);
  if (!job) throw new AppError(404, "Walkthrough unavailable.");
  if (job.status !== "completed" || !job.pages.length) throw new AppError(409, "Finish the page capture before selecting content.");
  return { pages: job.pages.map(page => ({ ...page, n: page.capture_id })), archived: db.website_walkthroughs.has_archived_export(scope.session, scope.capture) };
};

const catalog_content = (db: SessionStore, scope: TWalkthroughExportScope) => {
  const { pages, archived } = capture(db, scope);
  const source_revision = sha(JSON.stringify([scope.session, scope.kind, scope.capture,
    pages.map(({ n, title, caption, url, facts }) => [n, title, caption, url, facts])]));
  const items = pages.flatMap(page => {
    const item = (kind: TWalkthroughSelectionKind, text: string, index = 0): TWalkthroughSelectionItem => ({
      item_id: source_revision + "." + page.n + "." + kind + "." + index, kind, page_number: page.n, text,
    });
    return [...(page.title ? [item("title", page.title)] : []), ...(page.caption ? [item("caption", page.caption)] : []),
      ...page.facts.map((text, index) => item("fact", text, index)), item("url", page.url), item("screenshot", "Screenshot")];
  });
  return { source_revision, items, has_archived_export: archived };
};

export const walkthrough_selection_catalog = (db: SessionStore, scope: TWalkthroughExportScope): TWalkthroughSelectionCatalog =>
  ({ ...catalog_content(db, scope), exports: db.walkthrough_exports.list(scope) });

const screenshot = (db: SessionStore, scope: TWalkthroughExportScope, n: number) => {
  const bytes = scope.kind === "site-runs" ? db.site_runs.screenshot(scope.session, scope.capture, n)
    : db.website_walkthroughs.screenshot(scope.session, scope.capture, n);
  if (!bytes) throw new AppError(409, "The selected screenshot is unavailable. Review the selection again.");
  return Buffer.from(bytes);
};

// Chromium captures JPEGs. Read their SOF dimensions, including earlier captures made at different viewport sizes.
const jpeg_dimensions = (bytes: Buffer) => {
  if (bytes.length >= 4 && bytes.readUInt16BE() === 0xffd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9 || offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (length >= 8 && [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker!)) {
        const h = bytes.readUInt16BE(offset + 3), w = bytes.readUInt16BE(offset + 5);
        if (w && h) return { w, h };
        break;
      }
      offset += length;
    }
  }
  throw new AppError(422, "The selected screenshot could not be read. Review the selection and try again.");
};

// Rendering receives just the approved plan, selected URLs and selected image bytes. It has no capture or model access.
const render_selection = async (planned: TWalkthroughSelectionSlide[], images: Map<string, Buffer>, urls: Map<string, string>) => {
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_WIDE";
  deck.author = "copitch";
  deck.title = "";
  deck.subject = "";
  for (const planned_slide of planned) {
    const slide = deck.addSlide();
    slide.background = { color: "F5F5EC" };
    if (planned_slide.kind === "host") {
      slide.addText(planned_slide.host_text, { x: 0.65, y: 0.55, w: 12, h: 6.4, color: "17251C", fontFace: "Aptos",
        fontSize: 22, wrap: true, margin: 0, valign: "middle" });
      continue;
    }
    const text = planned_slide.items.filter(item => item.kind !== "screenshot");
    const screenshot_id = planned_slide.items.find(item => item.kind === "screenshot")?.item_id;
    const media = screenshot_id && images.get(screenshot_id);
    if (media) {
      const frame = text.length ? { x: 0.42, y: 0.65, w: 6.9, h: 6.2 } : { x: 0.42, y: 0.35, w: 12.49, h: 6.8 };
      const size = jpeg_dimensions(media);
      const scale = Math.min(frame.w / size.w, frame.h / size.h);
      const w = size.w * scale, h = size.h * scale;
      slide.addImage({ data: "image/jpeg;base64," + media.toString("base64"),
        x: frame.x + (frame.w - w) / 2, y: frame.y + (frame.h - h) / 2, w, h, altText: "" });
    }
    if (text.length) {
      const lines = text.map((item, index) => ({ text: item.text, options: {
        breakLine: index < text.length - 1, bold: item.kind === "title", paraSpaceAfter: 10,
        ...(item.kind === "url" && { hyperlink: { url: urls.get(item.item_id)! } }),
      } }));
      slide.addText(lines, { x: media ? 7.6 : 0.6, y: 0.45, w: media ? 5.2 : 12.1, h: 6.5,
        fontFace: "Aptos", fontSize: 20, color: "17251C", wrap: true, margin: 0, valign: "middle" });
    }
  }
  return Buffer.from(await deck.write({ outputType: "nodebuffer", compression: true }) as Uint8Array);
};

export const publish_walkthrough_selection = async (db: SessionStore, scope: TWalkthroughExportScope, input: TWalkthroughSelectionInput) => {
  const catalog = catalog_content(db, scope);
  if (input.source_revision !== catalog.source_revision) throw new AppError(409, "The source revision changed. Reopen and review its content.");
  const by_id = new Map(catalog.items.map(item => [item.item_id, item]));
  const items = input.item_ids.map(id => {
    const item = by_id.get(id);
    if (!item) throw new AppError(422, "A selected item is unavailable in this source revision.");
    return item;
  });
  const slides = planWalkthroughSelection(items, input.host_additions);
  const manifest = { source_revision: catalog.source_revision, items, slides, item_ids: input.item_ids, host_additions: input.host_additions };
  const hash = sha(JSON.stringify([manifest.source_revision, manifest.item_ids, manifest.host_additions]));
  const existing = db.walkthrough_exports.save(scope, input.request_id, hash, manifest);
  if (existing) return existing;
  const images = new Map(items.filter(item => item.kind === "screenshot").map(item => [item.item_id, screenshot(db, scope, item.page_number)]));
  const urls = new Map(items.filter(item => item.kind === "url").map(item => [item.item_id, item.text]));
  const bytes = await render_selection(slides, images, urls);
  return db.walkthrough_exports.save(scope, input.request_id, hash, manifest, bytes)!;
};
