import { expect, test } from "bun:test";
import { select_presentation_evidence } from "../src/services/presentation-planner";
import type { TResearchBundle } from "../src/types/research";

const bundle = (studio_notes: string[]): TResearchBundle => ({
  research_id: "r1", brief_id: "b1", gaps: [],
  confirmed_brief: { brief_id: "b1", studio_notes, summary: "Sleep and exams", question: null, urls: [], public_queries: [],
    source_policy: "public_search", materials: "", messages: [], history: [], sources: [],
    intent: { subject: "Sleep", audience: "Students", outcome: "Sleep before exams", deliverable: "3 slides" } } as never,
  findings: { title: "Sleep", sections: [] },
  evidence: [
    { id: "H1", origin: "host", location: "Host note", passage: "I love teaching study skills." },
    { id: "H2", origin: "host", location: "Host note", passage: "My dog is called Rex." },
  ],
});

test("a required host fact reaches the slide planner even when no research paragraph cites it", () => {
  expect(select_presentation_evidence(bundle(["I love teaching study skills."])).map(({ id }) => id)).toEqual(["H1"]);
  expect(select_presentation_evidence(bundle([])).map(({ id }) => id)).toEqual([]);
});
