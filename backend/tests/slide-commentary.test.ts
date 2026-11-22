import { expect, test } from "bun:test";
import { compile_deck, propose_slide } from "../src/services/deck";
import { without_commentary } from "../src/services/presentation-planner";

const beat = (highlights: string[]) => ({
  title: "I love classical music and mangoes", highlights, template: { type: "bullet_slide" as const }, evidence_ids: ["H5"],
  sentences: [{ text: "Outside work, I love classical music and mangoes.", evidence_ids: ["H5"] }],
});

test("slide purpose notes never reach the audience as highlights", () => {
  const cleaned = without_commentary(beat(["Adds a memorable personal detail.", "Keeps the intro human and friendly."]));
  expect(cleaned.highlights).toEqual(["Outside work, I love classical music and mangoes."]);
});

test("factual highlights are kept as written", () => {
  const facts = ["30k+ calls, emails and meetings processed", "Shows 70%+ accuracy gains", "Loves classical music"];
  expect(without_commentary(beat(facts)).highlights).toEqual(facts);
});

test("a mixed list keeps only the facts", () => {
  expect(without_commentary(beat(["Introduces the host by name and formal role.", "Software Engineer / AI Engineer"])).highlights)
    .toEqual(["Software Engineer / AI Engineer"]);
});

test("a title card removes repeated title components and keeps a distinct subtitle", () => {
  const opening = { ...beat(["Jordan", "AI Engineer", "Jordan — AI Engineer", "Built tools for research teams"]),
    title: "Jordan · AI Engineer", template: { type: "title_card" as const } };
  expect(without_commentary(opening).highlights).toEqual(["Built tools for research teams"]);
  expect(without_commentary({ ...opening, highlights: ["Jordan", "A strong opening"] }).highlights)
    .toEqual([]);
});

test("an exact title edit can preserve a title card with no highlights", () => {
  const slide = { slide_id: "intro", layout: "headline" as const, title: "Jordan", highlights: [],
    narration: "I build tools for onboarding teams.", evidence_ids: ["H1"], template: { type: "title_card" as const } };
  expect(propose_slide(slide, { title: "Meet Jordan" })).toEqual({ ...slide, title: "Meet Jordan" });
});

test("product walkthrough instructions remain valid audience content", () => {
  const action = "Add a source from the Sources menu. Press [Add] to open the import dialog.";
  const slide = without_commentary({ ...beat([action]), sentences: [{ text: action, evidence_ids: ["B12"] }] });
  expect(slide.highlights).toEqual([action]);
  expect(slide.sentences[0].text).toBe(action);
});

test("legacy source extracts put a cited finding on the slide instead of a memo direction", () => {
  const first = "Twelve teams enrolled in the onboarding pilot.";
  const passage = `${first} ${"Participants attended the scheduled workshop and received a link to the follow-up survey. ".repeat(6)}`;
  const deck = compile_deck({ research_id: "legacy", brief_id: "scope", gaps: [], grounding: { version: 1, mode: "source_extracts" },
    confirmed_brief: { brief_id: "scope", summary: "Review the pilot", question: null, source_policy: "files_only",
      public_queries: [], messages: [], materials: "", urls: [] },
    evidence: [{ id: "M1", location: "Enrollment report", origin: "material", passage }],
    findings: { title: "Onboarding pilot", sections: [{ heading: "First cohort", paragraphs: [
      { prose: passage, support: [{ evidence_id: "M1", excerpt: passage }] },
      { prose: "Insert a missing result here.", support: [{ evidence_id: "M1", excerpt: first }] },
    ] }] } });
  expect(deck.slides[0].highlights).toEqual([first]);
  expect(deck.slides[0].narration).toBe(passage.trim());
});
