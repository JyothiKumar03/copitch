import { expect, test } from "bun:test";
import { RoomUtteranceGate } from "./room-utterance";

const frameSize = 40;
const directDelay = 760;
const reflectionDelay = 858;

const signal = (seed: number, length: number) => {
  let state = seed;
  return Float32Array.from({ length }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x80000000 - 1;
  });
};

const band = (samples: Float32Array, index: number) =>
  ((samples[index - 1] ?? 0) + 2 * (samples[index] ?? 0) + (samples[index + 1] ?? 0)) / 4;

const playRoom = (hostFrames: number) => {
  const gate = new RoomUtteranceGate();
  const narration = signal(42, 82 * frameSize);
  const speech = signal(739, hostFrames * frameSize);
  const events = [];
  for (let frame = 0; frame < 140; frame++) {
    const at = frame * frameSize;
    const speaker = Float32Array.from({ length: frameSize }, (_, i) => band(narration, at + i) * 0.19);
    const mic = Float32Array.from({ length: frameSize }, (_, i) => {
      const room = 0.168 * band(narration, at + i - directDelay) +
        0.059 * band(narration, at + i - reflectionDelay);
      return room + 0.15 * band(speech, at + i - 65 * frameSize);
    });
    const event = gate.frame({ speaker, mic }, frame < 82);
    if (event) events.push({ ...event, frame });
  }
  return events;
};

test("delayed reflected narration and its tail never open the interruption gate", () => {
  expect(playRoom(0)).toEqual([]);
});

test("host speech interrupts ongoing narration and finishes as one utterance", () => {
  const events = playRoom(30);
  expect(events.map(event => event.kind)).toEqual(["onset", "end"]);
  expect(events[0].frame).toBeLessThan(76);
  expect(events[1].frame).toBeGreaterThan(94);
});

test("short unmatched sound can pause playback without creating a transcription clip", () => {
  expect(playRoom(8).map(event => event.kind)).toEqual(["onset", "discard"]);
});

test("mic startup and steady rumble are ignored, then idle host speech opens the gate", () => {
  const gate = new RoomUtteranceGate();
  const startup = signal(153, 9 * frameSize);
  const speech = signal(914, 30 * frameSize);
  const speaker = new Float32Array(frameSize);
  const events = [];
  for (let frame = 0; frame < 120; frame++) {
    const mic = Float32Array.from({ length: frameSize }, (_, i) => {
      const at = frame * frameSize + i;
      const rumble = 0.052 + 0.062 * Math.sin(2 * Math.PI * 30 * at / 2000);
      return rumble + 0.25 * band(startup, at) + 0.16 * band(speech, at - 42 * frameSize);
    });
    const event = gate.frame({ speaker, mic }, false);
    if (event) events.push({ kind: event.kind, frame });
  }
  expect(events.map(event => event.kind)).toEqual(["onset", "end"]);
  expect(events[0].frame).toBeGreaterThanOrEqual(42);
  expect(events[0].frame).toBeLessThan(50);
});
