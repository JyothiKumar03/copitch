import { expect, test } from "bun:test";
import { committedVoiceIds, createVoicePreview, pendingVoiceCaptions, readVoiceFragment } from "./voice-preview";

const committed = new Set<string>();
const feed = (buffer: ReturnType<typeof createVoicePreview>, speaker: "host" | "agent", delta: string, start: number, end: number, eventId: string) =>
  buffer.accept({ speaker, delta, start, end, eventId }, committed);

test("late host tokens fill the host draft while the assistant keeps replying", () => {
  const buffer = createVoicePreview("call-1");
  feed(buffer, "host", "Review the trial", 1000, 1800, "one");
  feed(buffer, "agent", "Here is", 1400, 1900, "two");
  expect(feed(buffer, "host", " results.", 1600, 1820, "three")).toBe("tail");
  feed(buffer, "agent", " what I found.", 1800, 2500, "four");
  expect(feed(buffer, "host", " results.", 1600, 1820, "three")).toBeNull();
  expect(buffer.captions().map(({ id, text }) => [id, text])).toEqual([
    ["live:call-1:1000", "Review the trial results."], ["agent:call-1:1400", "Here is what I found."],
  ]);
});

test("real provider gaps of 400 ms and 200 ms keep each reply's first caption and its identity", () => {
  const cases = [
    { hostEnd: 7000, agentStart: 7200, boundary: 7400, prefix: " Who’s", hostTail: " question?", next: " your audience for this talk?" },
    { hostEnd: 32800, agentStart: 32800, boundary: 33000, prefix: " Got it", hostTail: " club", next: ". What’s the main thing?" },
  ];
  for (const sample of cases) {
    const buffer = createVoicePreview("live-recording");
    feed(buffer, "host", "Synthetic input", sample.hostEnd - 200, sample.hostEnd, "host-first");
    feed(buffer, "agent", sample.prefix, sample.agentStart, sample.boundary, "agent-first");
    expect(feed(buffer, "host", sample.hostTail, sample.boundary, sample.boundary + 200, "host-final")).toBe("tail");
    feed(buffer, "agent", sample.next, sample.boundary, sample.boundary + 200, "agent-continued");
    expect(buffer.captions().map(({ id, text }) => [id, text])).toEqual([
      ["live:live-recording:" + (sample.hostEnd - 200), "Synthetic input" + sample.hostTail],
      ["agent:live-recording:" + sample.agentStart, sample.prefix + sample.next],
    ]);
  }
});

test("completed captions stay visible until the exact exchange is saved, including repeated wording on a new call", () => {
  const buffer = createVoicePreview("call-2");
  feed(buffer, "host", "Review the trial results.", 1000, 1800, "one");
  feed(buffer, "agent", "Here is what I found.", 1400, 3100, "two");
  buffer.seal();
  const history = [{ role: "host" as const, text: "Review the trial results.", voice_items: ["live:call-1:1000"] },
    { role: "assistant" as const, text: "Here is what I found.", voice_items: ["agent:call-2:1400"] }];
  expect(pendingVoiceCaptions(buffer.captions(), committedVoiceIds(history)).map(({ id, final }) => [id, final])).toEqual([
    ["live:call-2:1000", true],
  ]);
  buffer.reconcile(new Set(["live:call-2:1000", "agent:call-2:1400"]));
  expect(buffer.captions()).toEqual([]);
});

test("brief acknowledgements give way to the same host turn, while a new answer follows a complete exchange", () => {
  const buffer = createVoicePreview("call-3");
  feed(buffer, "host", "The pilot", 100, 400, "one");
  feed(buffer, "agent", "Mm-hm.", 500, 650, "two");
  feed(buffer, "host", " used two cohorts.", 710, 1100, "three");
  feed(buffer, "agent", "Which cohort should we present first?", 1200, 2900, "four");
  feed(buffer, "host", "London.", 3000, 3400, "five");
  expect(buffer.captions().map(({ text, final }) => [text, final])).toEqual([
    ["The pilot used two cohorts.", true], ["Which cohort should we present first?", true], ["London.", false],
  ]);
});

test("parses current provider frame fields and ignores non-caption events", () => {
  expect(readVoiceFragment({ type: "session.input_transcript.delta", delta: "Hi", start_ms: 0, end_ms: 200, event_id: "a" }))
    .toEqual({ speaker: "host", delta: "Hi", start: 0, end: 200, eventId: "a" });
  expect(readVoiceFragment({ type: "response.event", delta: "unexpected" })).toBeNull();
  expect(readVoiceFragment(null)).toBeNull();
});
