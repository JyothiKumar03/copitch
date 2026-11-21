import { expect, test } from "bun:test";
import { create_api } from "../src/app";
import { stream_context_markdown, verify_graph_document } from "../src/services/research-graphs";
import type { TGraphVerifier } from "../src/services/research-graphs";
import type { TEvidence } from "../src/types/research";
import { serve_api } from "./helpers/serve-api";

const public_record = (id: string, passage: string): TEvidence => ({ id, origin: "public", location: "Official export statistics", passage });
const fish = "In FY 2025–26, frozen fish exports reached USD 643.70 million.";
const shrimp = "Frozen shrimp exports reached 5,624.48 million US dollars in fiscal year 2025–26.";
const sources = [public_record("P1", fish), public_record("P2", shrimp), public_record("P3", "Unrelated article")];
const bars = {
  name: "Frozen fish & shrimp export value", description: "Products in the same fiscal year.", type: "bar",
  data: [
    { label: "Frozen fish", value: 643.7, unit: "USD million", period: "FY 2025–26", evidence_id: "P1", excerpt: fish },
    { label: "Frozen shrimp", value: 5624.48, unit: "million USD", period: "2025–26", evidence_id: "P2", excerpt: shrimp },
  ],
};
const wrap = (graph: unknown) => `<graph>${JSON.stringify(graph)}</graph>`;
const pass_review: TGraphVerifier = async review => review.units.map(({ id }) => ({ id, decision: "supported" }));
const signal = () => new AbortController().signal;

test("publishes independently verified non-revenue charts with canonical units and graph-only footnote references", async () => {
  const output = await verify_graph_document("untrusted surrounding text\n\n" + wrap(bars), sources, async review => {
    expect(review.evidence.map(row => row.id)).toEqual(["P1", "P2"]);
    expect(review.units).toHaveLength(3);
    expect(review.units[1].support).toEqual([{ evidence_id: "P1", excerpt: fish }]);
    return { verdicts: review.units.map(({ id }) => ({ id, decision: "supported" })) };
  }, signal());
  expect(output.graph_count).toBe(1);
  expect(output.evidence_ids).toEqual(["P1", "P2"]);
  expect(output.markdown).not.toContain("excerpt");
  expect(output.markdown).not.toContain("untrusted surrounding text");
  expect(output.markdown).toContain("Frozen fish \\u0026 shrimp");
  expect(output.markdown).toEndWith("</graph>\n\nGraph sources [^P1] [^P2]");
  const graph = JSON.parse(output.markdown.match(/^<graph>(.*)<\/graph>$/mu)![1]);
  expect(graph.data.map((row: { unit: string; period: string }) => [row.unit, row.period])).toEqual([
    ["USD million", "FY 2025–26"], ["USD million", "FY 2025–26"],
  ]);
});

test("the original PDF column controls each value and valid line dates are ordered", async () => {
  const row = "12 | Marine Products | 899.07 | 4874.02 | 1022.77 | 5523.20 | 13.76 | 13.32";
  const passage = "Export estimate (Values in Million USD)\nColumns: OCT'25 | APR'25-OCT'25 | OCT'26 | APR'26-OCT'26 | OCT'26 (% Change) | APR'26-OCT'26 (% Change)\n" + row;
  const evidence = [public_record("P4", passage)];
  const trend = { name: "Marine Products exports in October", description: "October comparison", type: "line", data: [
    { label: "2026-10", value: 1022.77, unit: "USD million", period: "2026-10", evidence_id: "P4", excerpt: row },
    { label: "Oct 2025", value: 899.07, unit: "USD million", period: "Oct 2025", evidence_id: "P4", excerpt: row },
  ] };
  const valid = await verify_graph_document(wrap(trend), evidence, pass_review, signal());
  expect(valid.graph_count).toBe(1);
  expect(valid.markdown.indexOf("Oct 2025")).toBeLessThan(valid.markdown.indexOf("2026-10"));
  let wrong_period_reviews = 0;
  trend.data[0].value = 5523.20;
  expect(await verify_graph_document(wrap(trend), evidence, async (review, signal) => { wrong_period_reviews++; return pass_review(review, signal); }, signal()))
    .toEqual({ markdown: "", graph_count: 0, evidence_ids: [] });
  expect(wrong_period_reviews).toBe(0);
  trend.data[0].value = 13.76;
  expect((await verify_graph_document(wrap(trend), evidence, pass_review, signal())).graph_count).toBe(0);
});

test("sentence punctuation does not change a quoted numeric value or admit a fractional prefix", async () => {
  const jan = "Revenue in January 2025: USD 1,200.";
  const feb = "Revenue in February 2025: USD 1,500.5.";
  const evidence = [public_record("P1", jan), public_record("P2", feb)];
  const proposal = { name: "Reported revenue", description: "Monthly reported values", type: "line", data: [
    { label: "January 2025", value: 1200, unit: "USD", period: "January 2025", evidence_id: "P1", excerpt: jan },
    { label: "February 2025", value: 1500.5, unit: "USD", period: "February 2025", evidence_id: "P2", excerpt: feb },
  ] };
  expect((await verify_graph_document(wrap(proposal), evidence, pass_review, signal())).graph_count).toBe(1);
  proposal.data[1].value = 1500;
  expect((await verify_graph_document(wrap(proposal), evidence, pass_review, signal())).graph_count).toBe(0);
});

test("binds split fiscal HTML table units and figures to the actual category and date columns", async () => {
  const table = "Category 2023-24 2024-25 2025-26\nWidgets Q: 180 250 300\nV: 20 24 32\n$: 40 50 60\nGadgets Q: 91 106 120\nV: 16 18 19\n$: 25 29 31";
  const url = "https://example.test/statistics";
  const legend = "Unit for all data is in Q: Quantity in M T, V: Value in Rs. Crore, $: US Dollar Million";
  const evidence = [{ ...public_record("P8", table), url }, { ...public_record("P9", legend), url }];
  const graph = { name: "Widget and gadget values", description: "Export value in the same fiscal year.", type: "bar", data: [
    { label: "Widgets", value: 60, unit: "USD million", period: "FY 2025–26", evidence_id: "P8", excerpt: "Widgets: 60" },
    { label: "Gadgets", value: 31, unit: "USD million", period: "FY 2025–26", evidence_id: "P8", excerpt: "Gadgets: 31" },
  ] };
  const accepted = await verify_graph_document(wrap(graph), evidence, async (review, signal) => {
    expect(review.units[1].support).toEqual([
      { evidence_id: "P8", excerpt: "Widgets Q: 180 250 300\nV: 20 24 32\n$: 40 50 60" }, { evidence_id: "P9", excerpt: legend },
    ]);
    return pass_review(review, signal);
  }, signal());
  expect(accepted.graph_count).toBe(1);
  expect(accepted.evidence_ids).toEqual(["P8", "P9"]);
  graph.data[0].value = 50;
  expect((await verify_graph_document(wrap(graph), evidence, pass_review, signal())).graph_count).toBe(0);
  graph.data[0].value = 60;
  expect((await verify_graph_document(wrap(graph), [evidence[0], { ...evidence[1], url: "https://example.test/another-source" }], pass_review, signal())).graph_count).toBe(0);
});

test("a malformed or mixed-window proposal can use only a verified same-marker table comparison", async () => {
  const passage = "Unit for all data is in Q: Quantity in M T, $: US Dollar Million\nCategory 2023-24 2024-25 2025-26\nWidgets Q: 180 250 300\n$: 40 50 60\nGadgets Q: 91 106 120\n$: 25 29 31\nTOTAL Q: 271 356 420\n$: 65 79 91";
  const evidence = [public_record("P8", passage)];
  const malformed = '<graph>{"name":"Mixed periods","data":[{"unit":"USD million","value":999,"evidence_id":"P8"}]}\\u003c/graph\\u003e';
  let reviews = 0;
  const output = await verify_graph_document(malformed, evidence, async (review, signal) => {
    reviews++;
    expect(review.units).toHaveLength(3);
    expect(review.units[0].text).toContain("Widgets: 60 US Dollar Million, 2025-2026");
    expect(review.units[0].text).toContain("Gadgets: 31 US Dollar Million, 2025-2026");
    return pass_review(review, signal);
  }, signal(), async () => { throw new Error("A complete table should avoid a second model proposal."); });
  expect(reviews).toBe(1);
  expect(output.graph_count).toBe(1);
  expect(output.markdown).not.toContain("999");
  expect(output.markdown).not.toContain("TOTAL");
  expect((await verify_graph_document("", evidence, pass_review, signal())).graph_count).toBe(0);
  expect((await verify_graph_document(malformed, evidence, async review => review.units.map(({ id }) => ({ id, decision: "unsupported" })), signal())).graph_count).toBe(0);
});

test("an independently checked partial comparison never publishes missing or misattributed points", async () => {
  const proposal = { ...bars, description: "Some points have no source support.", data: [
    ...bars.data, { ...bars.data[0], label: "Sardines", evidence_id: "P3", value: 676.12 },
  ] };
  const output = await verify_graph_document(wrap(proposal), sources, async (review, signal) => {
    expect(review.evidence.map(row => row.id)).toEqual(["P1", "P2"]);
    expect(review.units).toHaveLength(3);
    expect(review.units[0].text).toContain("Selected categories");
    expect(review.units.every(unit => !unit.text.includes("Sardines"))).toBe(true);
    return pass_review(review, signal);
  }, signal());
  expect(output.graph_count).toBe(1);
  expect(output.markdown).not.toContain("Sardines");
  expect(output.evidence_ids).toEqual(["P1", "P2"]);
});

test("a rejected chart gets one bounded re-proposal with relevant evidence and renewed independent verification", async () => {
  const january = "Revenue for January 2025 was USD 1200.";
  const february = "Revenue for February 2025 was USD 1500.";
  const evidence = [public_record("P1", january), public_record("P2", february), public_record("P3", "A company history without figures."),
    { id: "H1", origin: "host" as const, location: "Host note", passage: "January 2025 total was 4500." }];
  const chart = { name: "Monthly revenue", description: "The same monthly measurement.", type: "bar", data: [
    { label: "January 2025", period: "January 2025", unit: "USD", value: 1200, evidence_id: "P1", excerpt: january },
    { label: "February 2025", period: "February 2025", unit: "USD", value: 1500, evidence_id: "P2", excerpt: february },
  ] };
  let repairs = 0;
  let reviews = 0;
  const result = await verify_graph_document(wrap(chart), evidence, async (review, signal) => {
    reviews++;
    expect(review.units[0].text).toContain("line graph");
    return pass_review(review, signal);
  }, signal(), async request => {
    repairs++;
    expect(request.feedback.join(" ")).toContain("mixed reporting periods");
    expect(request.evidence.map(row => row.id)).toEqual(["P1", "P2"]);
    return wrap({ ...chart, type: "line" });
  });
  expect(result.markdown).toContain('"type":"line"');
  expect(repairs).toBe(1);
  expect(reviews).toBe(1);
  const failing_repair = async () => { repairs++; return wrap(chart); };
  expect((await verify_graph_document(wrap(chart), evidence, pass_review, signal(), failing_repair)).graph_count).toBe(0);
  expect(repairs).toBe(2);
  expect((await verify_graph_document("", evidence, pass_review, signal(), failing_repair)).graph_count).toBe(0);
  expect((await verify_graph_document(wrap(bars), sources, pass_review, signal(), failing_repair)).graph_count).toBe(1);
  expect(repairs).toBe(2);
});

test("rejects invented values, mismatched periods or scaling, hostile fields, and incomplete verification", async () => {
  const invalid = [
    { ...bars, name: "<script>raw</script>" },
    { ...bars, data: [{ ...bars.data[0], value: 5.7 }, bars.data[1]] },
    { ...bars, data: [{ ...bars.data[0], period: "2024–25" }, bars.data[1]] },
    { ...bars, data: [{ ...bars.data[0], unit: "USD billion" }, bars.data[1]] },
    { ...bars, data: [{ ...bars.data[0], evidence_id: "P99" }, bars.data[1]] },
    { ...bars, data: [{ ...bars.data[0], excerpt: "USD 643.70 million from a different source" }, bars.data[1]] },
  ];
  for (const proposal of invalid) expect((await verify_graph_document(wrap(proposal), sources, pass_review, signal())).graph_count).toBe(0);
  for (const raw of ["<graph>", "<graph><graph>" + JSON.stringify(bars) + "</graph></graph>", wrap(bars).replace("<graph>", "<graph foo>")]) {
    expect((await verify_graph_document(raw, sources, pass_review, signal())).markdown).toBe("");
  }
  expect((await verify_graph_document(wrap(bars), sources, undefined, signal())).graph_count).toBe(0);
  expect((await verify_graph_document(wrap(bars), sources, async () => [], signal())).graph_count).toBe(0);
  expect((await verify_graph_document(wrap(bars), sources, async review => review.units.map(({ id }, index) =>
    ({ id, decision: index ? "supported" : "missing_qualification" })), signal())).graph_count).toBe(0);
});

test("SSE reconstructs exact Unicode bytes and sends full canonical graph blocks in one delta", async () => {
  const graph = (await verify_graph_document(wrap(bars), sources, pass_review, signal())).markdown;
  const markdown = "# समग्र रिपोर्ट\n\n" + "𐍈🎯".repeat(999) + "\n\n" + graph + "\n\nMore verified text.";
  const app = create_api();
  app.get("/fixture", (_req, res) => stream_context_markdown(res, markdown));
  await using http = await serve_api(app);
  const response = await http.request("/fixture");
  expect(response.headers.get("Content-Type")).toContain("text/event-stream");
  const frames = (await response.text()).split("\n\n").filter(Boolean);
  expect(frames.at(-1)).toBe("event: done\ndata: {}");
  const deltas = frames.slice(0, -1).map(frame => JSON.parse(frame.split("data: ")[1]).text as string);
  expect(deltas.join("")).toBe(markdown);
  expect(deltas.filter(text => text.includes("<graph>"))).toEqual([graph.split("\n\n")[0]]);
});
