import { expect, test } from "bun:test";
import { fromBufferPromise } from "yauzl";
import { planWalkthroughSelection } from "../../shared/walkthrough-selection";
import type { TWalkthroughSelectionInput, TWalkthroughSelectionItem } from "../../shared/walkthrough-selection";
import { SessionStore } from "../src/repositories/session";
import type { TWalkthroughExportScope } from "../src/repositories/walkthrough-export";
import { publish_walkthrough_selection, selection_input, walkthrough_selection_catalog } from "../src/services/walkthrough-selection";

const url = "https://walkthrough.example.com/OMITTED_URL";
const selected_fact = "A team approved the paired gauges.";
const host_text = "Host-only observation\nRetain the second line.";
const image = Buffer.from("ffd8ffc0000b08038405a001011100ffd9", "hex");
const archive = Buffer.from("previously saved archive");
const seed = (db: SessionStore, kind: TWalkthroughExportScope["kind"], session: string, archived = false) => {
  const approved = { approved: true as const, request_id: crypto.randomUUID(), audience: "OMITTED_AUDIENCE", url,
    goal: "OMITTED_GOAL", max_depth: 2 };
  const pages = [
    { title: "OMITTED_TITLE", caption: "OMITTED_ACTION", url, facts: [selected_fact, "OMITTED_FACT"], n: 1, depth: 0 },
    { title: "OMITTED_SECOND", caption: "OMITTED_SECOND_ACTION", url: url + "/two", facts: ["OMITTED_SECOND_FACT"], n: 2, depth: 1 },
  ];
  if (kind === "site-runs") {
    const jobs = db.site_runs;
    const started = jobs.enqueue(session, approved, 2, "browser");
    const lease = jobs.claim()!;
    for (const page of pages) {
      lease.checkpoint.steps.push(page);
      jobs.checkpoint(lease, lease.checkpoint, { n: page.n, bytes: page.n === 1 ? image : Buffer.from("OMITTED_IMAGE") });
    }
    jobs.complete(lease, "OMITTED_SUMMARY", archived ? archive : undefined);
    return { session, kind, capture: started.run_id };
  }
  const jobs = db.website_walkthroughs;
  const started = jobs.enqueue(session, approved);
  const lease = jobs.claim()!;
  jobs.progress(lease, [{ url, status: "failed", reason: "OMITTED_WALL" }], true);
  jobs.complete(lease, pages.map(p => ({ ...p, capture_id: p.n, screenshot: p.n === 1 ? image : Buffer.from("OMITTED_IMAGE") })),
    archived ? archive : undefined);
  return { session, kind, capture: started.walkthrough_id };
};

const unpack = async (bytes: Uint8Array) => {
  const zip = await fromBufferPromise(Buffer.from(bytes));
  const xml: string[] = [];
  const media: Buffer[] = [];
  const slides: string[] = [];
  try {
    for await (const entry of zip.eachEntry()) {
      if (!entry.uncompressedSize) continue;
      const stream = await zip.openReadStreamPromise(entry);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      const content = Buffer.concat(chunks);
      if (entry.fileName.startsWith("ppt/media/")) media.push(content);
      else {
        xml.push(content.toString());
        if (/^ppt\/slides\/slide\d+\.xml$/u.test(entry.fileName)) slides.push(content.toString());
      }
    }
  } finally { zip.close(); }
  return { xml: xml.join("\n"), media, slides };
};

for (const kind of ["site-runs", "website-walkthroughs"] as const) {
  test(kind + " exports selected material only, isolates saved confirmations, and preserves archived bytes", async () => {
    const db = new SessionStore(":memory:");
    const scope = seed(db, kind, crypto.randomUUID(), true);
    const original = walkthrough_selection_catalog(db, scope);
    expect(original.has_archived_export).toBe(true);
    expect(original.exports).toEqual([]);
    const fact = original.items.find(item => item.text === selected_fact)!;
    const picture = original.items.find(item => item.kind === "screenshot" && item.page_number === 1)!;
    const link = original.items.find(item => item.kind === "url")!;
    const request: TWalkthroughSelectionInput = { approved: true, request_id: crypto.randomUUID(),
      source_revision: original.source_revision, item_ids: [fact.item_id, picture.item_id], host_additions: [host_text] };
    const first = await publish_walkthrough_selection(db, scope, request);
    expect(first.revision).toBe(1);
    expect(first.items).toEqual([fact, picture]);
    expect(first.host_additions).toEqual([host_text]);
    const bytes = db.walkthrough_exports.download(scope, first.export_id)!;
    const packed = await unpack(bytes);
    expect(packed.media).toEqual([image]);
    expect(packed.slides).toHaveLength(2);
    expect(packed.slides[0]).toContain(selected_fact);
    const image_geometry = packed.slides[0]!.match(/<p:pic>.*?<a:ext cx="(\d+)" cy="(\d+)"/su);
    expect(image_geometry).toBeTruthy();
    expect(Number(image_geometry![1]) / Number(image_geometry![2])).toBeCloseTo(1440 / 900, 5);
    expect(packed.slides[1]).toContain("Host-only observation");
    expect(packed.slides[1]).toContain("Retain the second line.");
    expect(packed.xml).not.toContain("OMITTED_");
    expect(packed.xml).not.toContain("TargetMode=\"External\"");
    expect(packed.xml).not.toContain("Walkthrough coverage");
    expect(await publish_walkthrough_selection(db, scope, request)).toEqual(first);
    const duplicates = await Promise.all([1, 2].map(() => publish_walkthrough_selection(db, scope, { ...request, request_id: crypto.randomUUID() })));
    expect(duplicates).toEqual([first, first]);
    await expect(publish_walkthrough_selection(db, scope, { ...request, item_ids: [link.item_id] })).rejects.toThrow("content changed");
    await expect(publish_walkthrough_selection(db, scope, { ...request, source_revision: "0".repeat(64) })).rejects.toThrow("revision changed");
    await expect(publish_walkthrough_selection(db, scope, { ...request, item_ids: ["unknown-item"] })).rejects.toThrow("unavailable");
    const changed = await publish_walkthrough_selection(db, scope, { ...request, request_id: crypto.randomUUID(), item_ids: [link.item_id], host_additions: [] });
    expect(changed.revision).toBe(2);
    const changed_pptx = await unpack(db.walkthrough_exports.download(scope, changed.export_id)!);
    expect(changed_pptx.media).toEqual([]);
    expect(changed_pptx.slides).toHaveLength(1);
    expect(changed_pptx.xml).toContain(url);
    expect(changed_pptx.xml).not.toContain(selected_fact);
    expect(changed_pptx.xml).not.toContain("OMITTED_TITLE");
    expect(changed_pptx.xml).not.toContain("Host-only observation");
    expect(db.walkthrough_exports.download(scope, first.export_id)).toEqual(bytes);
    const addition_only = await publish_walkthrough_selection(db, scope, { ...request,
      request_id: crypto.randomUUID(), item_ids: [], host_additions: [host_text] });
    const addition_pptx = await unpack(db.walkthrough_exports.download(scope, addition_only.export_id)!);
    expect(addition_pptx.slides).toHaveLength(1);
    expect(addition_pptx.media).toEqual([]);
    expect(addition_pptx.xml).toContain("Retain the second line.");
    expect(addition_pptx.xml).not.toContain("OMITTED_");
    expect(addition_pptx.xml).not.toContain(selected_fact);
    const second = seed(db, kind, scope.session);
    expect(walkthrough_selection_catalog(db, second).has_archived_export).toBe(false);
    await expect(publish_walkthrough_selection(db, second, request)).rejects.toThrow("revision changed");
    expect(db.walkthrough_exports.download(second, first.export_id)).toBeUndefined();
    expect(db.walkthrough_exports.download({ ...scope, session: crypto.randomUUID() }, first.export_id)).toBeUndefined();
    expect(walkthrough_selection_catalog(db, scope).exports).toEqual([addition_only, changed, first]);
    const jobs = kind === "site-runs" ? db.site_runs : db.website_walkthroughs;
    expect(Buffer.from(jobs.download(scope.session, scope.capture)!)).toEqual(archive);
    expect(jobs.download(second.session, second.capture)).toBeNull();
  });
}

test("only positively approved unique items or nonblank literal host additions are accepted", () => {
  const input = { approved: true, request_id: crypto.randomUUID(), source_revision: "1".repeat(64), host_additions: [], item_ids: [] };
  expect(selection_input.safeParse(input).success).toBe(false);
  expect(selection_input.safeParse({ ...input, item_ids: ["a", "a"] }).success).toBe(false);
  expect(selection_input.safeParse({ ...input, item_ids: ["a"], approved: false }).success).toBe(false);
  expect(selection_input.safeParse({ ...input, host_additions: ["  "] }).success).toBe(false);
  expect(selection_input.safeParse({ ...input, host_additions: ["a".repeat(2001)] }).success).toBe(false);
  expect(selection_input.safeParse({ ...input, host_additions: [host_text] }).success).toBe(true);
});


test("dense approved inputs paginate in selection order with lossless host text and no duplicated screenshots", () => {
  const items: TWalkthroughSelectionItem[] = Array.from({ length: 12 }, (_, i) => ({
    item_id: "fact-" + i, kind: "fact", page_number: 1,
    text: ("Selected fact " + i + " retains this sentence and literal punctuation. ").repeat(5) + "END " + i,
  }));
  items.splice(4, 0, { item_id: "picture", kind: "screenshot", page_number: 1, text: "Screenshot" });
  const additions = ["注記ＷＷ" + ("First line\n\nSecond paragraph preserves its spaces.  ").repeat(30), "Final host slide"];
  const planned = planWalkthroughSelection(items, additions);
  expect(planned.length).toBeGreaterThan(5);
  const shown = planned.flatMap(s => s.items);
  expect(shown.map(i => i.item_id).filter((id, index, all) => all.indexOf(id) === index)).toEqual(items.map(i => i.item_id));
  expect(shown.filter(i => i.kind === "screenshot")).toHaveLength(1);
  for (const item of items) expect(shown.filter(i => i.item_id === item.item_id).map(i => i.text).join("")).toBe(item.text);
  expect(planned.flatMap(s => s.kind === "host" ? [s.host_text] : []).join("")).toBe(additions.join(""));
});
