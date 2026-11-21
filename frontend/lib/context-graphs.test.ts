import { expect, test } from "bun:test";
import { createContextGraphDecoder, decodeContextGraphs, graphPlaceholder } from "./context-graphs";

const spec = { type: "bar", name: "Exports by product", description: "Comparable values.", data: [
  { label: "Fish", value: 643.7, unit: "USD million", period: "FY 2025–26", evidence_id: "P1" },
  { label: "Shrimp", value: 5624.48, unit: "USD million", period: "FY 2025–26", evidence_id: "P2" },
] };
const graph = `<graph>${JSON.stringify(spec)}</graph>`;

test("uses the same grammar across every token break and plain Markdown", () => {
  const input = "# Research\n\n" + graph + "\n\nGraph sources [^P1] [^P2]\n\n[^P1]: Source";
  const fromTokens = createContextGraphDecoder();
  for (const char of input) fromTokens.push(char);
  const final = fromTokens.preview(true);
  expect(final).toEqual(decodeContextGraphs(input));
  expect([...final.graphs.values()]).toEqual([spec]);
  const offset = [...final.graphs.keys()][0];
  expect(final.markdown.slice(offset)).toStartWith("\x60\x60\x60" + graphPlaceholder);
  expect(final.markdown).toContain("Graph sources [^P1] [^P2]");
});

test("holds an incomplete opening or closing marker outside the preview", () => {
  const decoder = createContextGraphDecoder();
  decoder.push("# Context\n\n<gra");
  expect(decoder.preview().markdown).toBe("# Context\n\n");
  decoder.push(graph.slice(4, -3));
  expect(decoder.preview().graphs.size).toBe(0);
  expect(decoder.preview().markdown).toBe("# Context\n\n");
  expect(decoder.preview(true).rejectedGraphs).toBe(1);
  decoder.push(graph.slice(-3));
  expect(decoder.preview(true).graphs.size).toBe(1);
  expect(decoder.preview(true).rejectedGraphs).toBe(0);
});

test("rejects malformed and mismatched graphs and leaves Markdown examples inert", () => {
  const wrong = { ...spec, data: spec.data.map(({ unit, ...point }, i) => ({ ...point, unit: i ? "kg" : unit })) };
  const output = decodeContextGraphs("\x60\x60\x60text\n" + graph + "\n\x60\x60\x60\n\n<graph>{oops}</graph>\n\n<graph>" + JSON.stringify(wrong) + "</graph>\n\nAfter.");
  expect(output.graphs.size).toBe(0);
  expect(output.rejectedGraphs).toBe(2);
  expect(output.markdown).toContain(graph);
  expect(output.markdown).not.toContain("{oops}");
  expect(output.markdown).toEndWith("After.");
});

test("discards an overlong graph and recovers the next block", () => {
  const decoder = createContextGraphDecoder();
  decoder.push("<graph>" + "x".repeat(32_768));
  decoder.push("extra</gr");
  decoder.push("aph>\n\n" + graph);
  expect(decoder.preview(true).graphs.size).toBe(1);
  expect(decoder.preview(true).rejectedGraphs).toBe(1);
});
