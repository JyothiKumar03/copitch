import { expect, test } from "bun:test";
import { UtteranceGate, encodeSpeechWav } from "../../frontend/lib/voice/utterance-gate";
import { openHandsFree } from "../../frontend/lib/voice/hands-free-capture";

const rate = 16000;
const size = 320;
const silent = new Float32Array(size);
const tone = (frame: number, hz: number, gain: number) => Float32Array.from({ length: size },
  (_, i) => gain * Math.sin(2 * Math.PI * hz * (frame * size + i) / rate));

test("isolated clicks and high-band noise do not open a turn; a voiced onset retains pre-roll and ends after 700 ms", async () => {
  const gate = new UtteranceGate();
  for (let i = 0; i < 50; i++) {
    const mic = i === 12 ? tone(i, 190, 0.2) : tone(i, 7100, 0.03);
    expect(gate.frame({ mic, speaker: silent }, false)).toBeUndefined();
  }
  for (let i = 0; i < 5; i++) {
    const event = gate.frame({ mic: tone(i, 190, 0.13), speaker: silent }, false);
    expect(event?.kind).toBe(i === 4 ? "onset" : undefined);
  }
  for (let i = 0; i < 34; i++) expect(gate.frame({ mic: silent, speaker: silent }, false)).toBeUndefined();
  const end = gate.frame({ mic: silent, speaker: silent }, false);
  expect(end?.kind).toBe("end");
  if (end?.kind !== "end") throw new Error("Expected a completed utterance");
  expect(end.frames).toHaveLength(50);
  const wav = await encodeSpeechWav(end.frames, rate).arrayBuffer();
  expect(new TextDecoder().decode(wav.slice(0,4))).toBe("RIFF");
  expect(new DataView(wav).getUint32(24, true)).toBe(16000);
  expect(wav.byteLength).toBe(44 + 50 * 320 * 2);
  expect((await encodeSpeechWav([new Float32Array(960)], 48000).arrayBuffer()).byteLength).toBe(44 + 320 * 2);
});

test("delayed playback echo stays suppressed and overlapping host speech meets the longer barge-in threshold", () => {
  const gate = new UtteranceGate();
  for (let i = 0; i < 36; i++) {
    const speaker = tone(i, 380, 0.15);
    const mic = i < 4 ? silent : tone(i - 4, 380, 0.07);
    expect(gate.frame({ mic, speaker }, true)).toBeUndefined();
  }
  for (let i = 0; i < 9; i++) {
    const speaker = tone(i, 380, 0.15);
    const host = tone(i, 155, 0.17);
    const mic = host.map((x, j) => x + 0.3 * speaker[j]);
    expect(gate.frame({ mic, speaker }, true)?.kind).toBe(i === 8 ? "onset" : undefined);
  }
  gate.reset();
  for (let i = 0; i < 65; i++) {
    const speaker = tone(i, 290, 0.2);
    expect(gate.frame({ mic: speaker, speaker }, true)?.kind).toBe(i === 64 ? "feedback" : undefined);
  }
});

test("cancelling while microphone permission is pending closes the audio context and releases the late track", async () => {
  let released = 0, closed = 0;
  let grant!: (value: unknown) => void;
  let requesting!: () => void;
  const pending = new Promise(resolve => { grant = resolve; });
  const started = new Promise<void>(resolve => { requesting = resolve; });
  const originals = ["AudioContext","AudioWorkletNode","navigator"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis,key)] as const);
  try {
    class Context {
      async resume() {}
      async close() { closed++; }
    }
    Object.defineProperty(globalThis,"AudioContext",{ configurable:true,value:Context });
    Object.defineProperty(globalThis,"AudioWorkletNode",{ configurable:true,value:class {} });
    Object.defineProperty(globalThis,"navigator",{ configurable:true,value:{ mediaDevices:{
      getUserMedia: () => { requesting(); return pending; },
    } } });
    const ctrl = new AbortController();
    const capture = openHandsFree(ctrl.signal,{
      blocked:() => false, playing:() => false, onStart:() => {}, onEnd:() => {}, onFailure:() => {},
    });
    await started; ctrl.abort();
    grant({ getTracks:() => [{ stop:() => { released++; } }] });
    await expect(capture).rejects.toThrow();
    expect(closed).toBe(1);
    expect(released).toBe(1);
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis,key,descriptor);
      else Reflect.deleteProperty(globalThis,key);
    }
  }
});
