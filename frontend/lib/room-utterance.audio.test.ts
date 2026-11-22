import { expect, test } from "bun:test";
import { RoomUtteranceGate } from "./room-utterance";

const readWav = async (name: string) => {
  const wav = new DataView(await Bun.file(new URL(`./fixtures/room-audio/${name}.wav`, import.meta.url)).arrayBuffer());
  if (wav.getUint16(22, true) !== 1 || wav.getUint32(24, true) !== 16_000 ||
      wav.getUint16(34, true) !== 16 || wav.getUint32(36) !== 0x64617461) throw new Error("Expected mono 16 kHz PCM fixture");
  return Float32Array.from({ length: wav.getUint32(40, true) / 2 }, (_, index) => wav.getInt16(44 + index * 2, true) / 32768);
};

const question = await readWav("question");
const narration = await readWav("narration");
const silence = await readWav("silence");
const frameSamples = 320;
const questionFrame = 75;
const voiceLevels = [0.015, 0.02, 0.04, 0.08];

const withActiveRms = (samples: Float32Array, target: number) => {
  const active = samples.filter(value => Math.abs(value) > 0.01);
  const rms = Math.sqrt(active.reduce((sum, value) => sum + value * value, 0) / active.length);
  return samples.map(value => value * target / rms);
};

const reflected = (samples: Float32Array, at: number) =>
  (samples[at - 32] ?? 0) + 0.5 * (samples[at - 112] ?? 0) + 0.32 * (samples[at - 240] ?? 0) +
  0.2 * (samples[at - 480] ?? 0) + 0.12 * (samples[at - 800] ?? 0);

const runRoom = ({ level, echo, reference }: { level: number; echo: number; reference: boolean }) => {
  const host = withActiveRms(question, level);
  const far = withActiveRms(narration, echo);
  const gate = new RoomUtteranceGate();
  const events: { frame: number; kind: string }[] = [];
  let noise = 41;
  for (let frame = -questionFrame; frame < 295; frame++) {
    const at = frame * frameSamples;
    const speaker = Float32Array.from({ length: frameSamples }, (_, index) =>
      0.6 * (reference ? narration[at + index] ?? 0 : 0));
    const mic = Float32Array.from({ length: frameSamples }, (_, index) => {
      const sample = at + index;
      const voice = host[sample - questionFrame * frameSamples] ?? 0;
      noise = (Math.imul(noise, 1_664_525) + 1_013_904_223) >>> 0;
      return voice + reflected(far, sample) + silence[index] + (noise / 0x100000000 - 0.5) * 0.002;
    });
    const event = gate.frame({ mic, speaker }, frame >= 0 && at < narration.length);
    if (event) events.push({ frame, kind: event.kind });
  }
  return events;
};

for (const [room, echo] of [["headphones", 0], ["speaker with browser echo cancellation", 0.006], ["speaker without browser echo cancellation", 0.05]] as const) {
  test(`recorded host speech reaches the gate within 300 ms on ${room}`, () => {
    for (const level of voiceLevels) {
      const events = runRoom({ level, echo, reference: true });
      const onset = events.find(event => event.kind === "onset");
      expect(onset).toBeDefined();
      expect(onset!.frame).toBeGreaterThanOrEqual(questionFrame);
      expect((onset!.frame - questionFrame) * 20).toBeLessThanOrEqual(300);
      expect(events.some(event => event.kind === "end")).toBe(true);
    }
  });

  test(`recorded narration alone does not open the gate on ${room}`, () => {
    expect(runRoom({ level: 0, echo, reference: true })).toEqual([]);
  });
}

test("room echo does not independently open a capture when the reference is missing", () => {
  expect(runRoom({ level: 0, echo: 0.05, reference: false })).toEqual([]);
});
