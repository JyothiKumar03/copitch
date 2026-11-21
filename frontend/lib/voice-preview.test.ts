import { expect, test } from "bun:test";
import { isLateHostCaption, liveCaption } from "./voice-preview";

const merged = [{ role: "host" as const, text: "Now, obviously, it should be able to. Read my website.", turn_id: "t1", voice_items: ["item_a", "item_b"] }];

test("a caption disappears once the saved turn that contains its speech item exists", () => {
  expect(liveCaption(merged, { speaker: "host", id: "item_b", text: "Read my website.", final: true })).toBeNull();
  expect(liveCaption(merged, { speaker: "host", id: "item_a", text: "Now, obviously, it should be able to.", final: true })).toBeNull();
});

test("a caption stays visible until its speech is saved, even when its words match an earlier turn", () => {
  const caption = { speaker: "host" as const, id: "item_c", text: "Read my website.", final: true };
  expect(liveCaption(merged, caption)).toEqual(caption);
});

test("the agent's spoken caption is replaced by the saved reply it reads out", () => {
  const history = [...merged, { role: "assistant" as const, text: "What does your website offer?", turn_id: "t1" }];
  expect(liveCaption(history, { speaker: "agent", id: "resp_1", text: "What does your website", final: false })).toBeNull();
});

test("contiguous timestamp overlap cannot displace the reply caption, but a new speech onset can", () => {
  expect(isLateHostCaption(3800, 3800, 4000)).toBe(true);
  expect(isLateHostCaption(4200, 4000, 4600)).toBe(false);
  expect(isLateHostCaption(undefined, 4000, 4600)).toBe(false);
});
