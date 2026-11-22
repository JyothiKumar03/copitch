import { expect, test } from "bun:test";
import { allowed_actions, parse_state } from "../src/types/studio-turn";

test("legacy project state preserves notes and attachments without authorizing a proposal", () => {
  const old = { language_preference: "hi", entities: { subject: "myself", audience: "My team", decision: "nothing..",
    urls: ["https://example.com/"], facts: ["Example Studio"] }, source_policy: "public_search",
    source_ids: ["b46b2b81-d6a6-4d39-98df-2691c0fbfc8c"], materials: "Private notes." };
  const state = parse_state(old, true);
  expect(state).toMatchObject({ phase: "done", goal: null, notes: ["myself", "My team", "nothing..", "https://example.com/", "Example Studio"],
    reply_language: "hi", proposal: null, proposal_heard: false, source_ids: old.source_ids, materials: "Private notes." });
  expect(state.factual_notes).toBeUndefined();
});
test("researching permits response language and a proposed mission change", () => {
  expect(allowed_actions.researching).toEqual(["set_reply_language", "mission_command"]);
});
