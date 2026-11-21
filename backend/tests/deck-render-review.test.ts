import { expect, test } from "bun:test";
import { prepare_reviewed_deck } from "../src/services/deck-render-review";
import type { TDeck, TDeckLayoutIssue } from "../src/types/deck";
import type { TResearchBundle } from "../src/types/research";

const bundle: TResearchBundle = {
  research_id: "research", brief_id: "brief", markdown: "", gaps: [],
  grounding: { version: 1, mode: "verified" },
  confirmed_brief: { brief_id: "brief", summary: "Introduce the project", question: null,
    source_policy: "files_only", urls: [], public_queries: [], messages: [], materials: "" },
  findings: { title: "Pilot", sections: [] }, evidence: [],
};
const deck: TDeck = {
  deck_id: "deck", research_id: bundle.research_id, revision: 1, grounding_mode: "verified", title: "Pilot",
  slides: [{ slide_id: "slide-1", layout: "headline", title: "Purpose", highlights: ["Initial draft"],
    narration: "The pilot checked onboarding.", evidence_ids: ["H1"] }],
};
const issue: TDeckLayoutIssue = {
  slide_id: "slide-1", issue: "visual_hierarchy", viewport: "1280×720", note: "The highlights overpower the title.",
};
const screenshot = Buffer.from("contact sheet");

test("three browser screenshots exhaust review without returning an unsatisfactory deck for persistence", async () => {
  let renders = 0;
  let inspections = 0;
  let repairs = 0;
  let saved = 0;
  await expect(prepare_reviewed_deck(bundle, { slide_count: 1 }, {
    prepare: async (_bundle, _pitch, _plan, _verify, repair) => {
      if (repair) {
        expect(repair.issues).toEqual([issue]);
        repairs++;
      }
      return deck;
    },
    render: async candidate => {
      expect(candidate).toBe(deck);
      renders++;
      return { issues: [], screenshot };
    },
    inspect: async (_candidate, image) => {
      expect(image).toBe(screenshot);
      inspections++;
      return [issue];
    },
  }).then(() => { saved++; })).rejects.toThrow("three-pass limit");
  expect({ renders, inspections, repairs, saved }).toEqual({ renders: 3, inspections: 3, repairs: 2, saved: 0 });
});

test("the second browser review publishes only the revised deck that clears targeted feedback", async () => {
  const revised = { ...deck, slides: [{ ...deck.slides[0], highlights: ["Pilot purpose"] }] };
  const geometry: TDeckLayoutIssue = { ...issue, issue: "overflow", viewport: "390×844" };
  const rendered: TDeck[] = [];
  const inspected: TDeck[] = [];
  const result = await prepare_reviewed_deck(bundle, { slide_count: 1 }, {
    prepare: async (_bundle, _pitch, _plan, _verify, repair) => {
      if (!repair) return deck;
      expect(repair).toEqual({ deck, issues: [geometry] });
      return revised;
    },
    render: async candidate => {
      rendered.push(candidate);
      return { issues: candidate === deck ? [geometry] : [], screenshot };
    },
    inspect: async (candidate, image) => {
      expect(image).toBe(screenshot);
      inspected.push(candidate);
      return [];
    },
  });
  expect(rendered).toEqual([deck, revised]);
  expect(inspected).toEqual([revised]);
  expect(result).toEqual({ ...revised, render_review: { status: "passed", rounds: 2 } });
});

test("existing duration-based callers still use the previous preparation path", async () => {
  const result = await prepare_reviewed_deck(bundle, { audience: "Team", duration_minutes: 1 }, {
    prepare: async () => deck,
    render: async () => { throw new Error("The legacy route does not render during preparation"); },
    inspect: async () => { throw new Error("The legacy route does not inspect during preparation"); },
  });
  expect(result).toBe(deck);
});

test("visual review cannot publish a shorter deck even when its layout is valid", async () => {
  let rendered = false;
  await expect(prepare_reviewed_deck(bundle, { slide_count: 10 }, {
    prepare: async () => deck,
    render: async () => { rendered = true; return { issues: [], screenshot }; },
    inspect: async () => [],
  })).rejects.toThrow("Only 1 of 10 requested slides passed review");
  expect(rendered).toBe(false);
});
