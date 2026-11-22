import { expect, test } from "bun:test";
import { upcoming_narration } from "../src/services/presentation-live";
import type { TDeck } from "../src/types/deck";
import type { TPresentationStored } from "../src/types/presentation-live";

const deck = { slides: [
  { slide_id: "s1", narration: "One. Two. Three." },
  { slide_id: "s2", narration: "Four. Five." },
] } as unknown as TDeck;
const at = (slide_id: string, sentence_index: number, pending_advance: unknown = null) =>
  ({ cursor: { slide_id, sentence_index }, pending_advance } as unknown as TPresentationStored);

test("the next narration sentences continue on the slide, then cross to the next slide", () => {
  expect(upcoming_narration(at("s1", 0), deck, 2)).toEqual(["Two.", "Three."]);
  expect(upcoming_narration(at("s1", 2), deck, 2)).toEqual(["Four.", "Five."]);
  expect(upcoming_narration(at("s2", 1), deck, 2)).toEqual([]);
});

test("an accepted live edit warms its own remaining sentences", () => {
  expect(upcoming_narration(at("s1", 0, { sentences: ["Edited A.", "Edited B.", "Edited C."], next: 0 }), deck, 2)).toEqual(["Edited B.", "Edited C."]);
});
