import { expect, test } from "bun:test";
import { publicSourceLabels } from "../../shared/presentation";
import { deck_sources } from "../src/services/deck";
import { parse_source, source_evidence, source_kind } from "../src/services/source";
import type { TResearchBundle } from "../src/types/research";

test("captured website pages become cited evidence that keeps the page link and screenshot", async () => {
  const image = "/api/sessions/s1/website-walkthroughs/w1/screenshots/2";
  const evidence = source_evidence({ source_id: crypto.randomUUID(), filename: "www.example.com walkthrough", kind: "web", locations: 1, gaps: [],
    records: [{ number: 1, text: "Projects: 15 projects across agents and tools.", url: "https://www.example.com/projects", image }] });
  expect(evidence[0]).toMatchObject({ origin: "material", url: "https://www.example.com/projects", image,
    location: "www.example.com walkthrough, page 1" });
  const bundle = { evidence } as TResearchBundle;
  const [source] = deck_sources(bundle, new Set([evidence[0].id]));
  expect(source).toMatchObject({ url: "https://www.example.com/projects", image, location: "www.example.com walkthrough, page 1" });
  expect(publicSourceLabels([source], [source.id])).toEqual(["example.com"]);
  // Uploaded files stay generic on audience slides.
  expect(publicSourceLabels([{ id: "F1", origin: "material" }], ["F1"])).toEqual(["Supplied material"]);
});

test("a web capture cannot be uploaded as a file", async () => {
  expect(() => source_kind("site.web")).toThrow();
  await expect(parse_source("site.web", Buffer.from("x"))).rejects.toThrow();
});
