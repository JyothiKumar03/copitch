// Feeds real speech + narration echo through RoomUtteranceGate exactly as the worklet does (20 ms frames at 48 kHz).
import { RoomUtteranceGate as Head } from "./gate-head";
import { RoomUtteranceGate as Now } from "../../../frontend/lib/room-utterance";

const read = async (path: string) => {
  const buf = new DataView(await Bun.file(path).arrayBuffer());
  let at = 12;
  while (at < buf.byteLength) {
    const id = String.fromCharCode(...[0, 1, 2, 3].map(i => buf.getUint8(at + i)));
    const size = buf.getUint32(at + 4, true);
    if (id === "data") {
      const out = new Float32Array(size / 4);
      for (let i = 0; i < out.length; i++) out[i] = buf.getFloat32(at + 8 + i * 4, true);
      return out;
    }
    at += 8 + size + (size % 2);
  }
  throw new Error("no data chunk");
};
const activeRms = (x: Float32Array) => {
  let s = 0, n = 0;
  for (const v of x) if (Math.abs(v) > 0.01) { s += v * v; n++; }
  return Math.sqrt(s / Math.max(1, n));
};
const scaled = (x: Float32Array, rms: number) => { const g = rms / activeRms(x); return x.map(v => v * g); };
// Small-room impulse response: direct path plus decaying reflections (delays in samples at 48 kHz).
const room = (x: Float32Array) => {
  const taps: [number, number][] = [[96, 1], [336, .5], [720, .32], [1440, .2], [2400, .12]];
  const y = new Float32Array(x.length);
  for (const [d, g] of taps) for (let i = d; i < x.length; i++) y[i] += g * x[i - d];
  return y;
};

const host = await read("host.wav");
const narr = await read("narr.wav");
const FRAME = 960, START = 1.5 * 48000;

type TCase = { voice: number; echo: number; reference: boolean; playing: boolean };
const run = (Gate: typeof Head | typeof Now, c: TCase) => {
  const voice = scaled(host, c.voice);
  const echo = c.echo ? room(scaled(narr, c.echo)) : new Float32Array(narr.length);
  const total = Math.max(narr.length, START + voice.length + 48000);
  const gate = new Gate();
  let first: number | null = null, falseOnsets = 0;
  for (let f = 0; f * FRAME + FRAME <= total; f++) {
    const mic = new Float32Array(FRAME), speaker = new Float32Array(FRAME);
    for (let i = 0; i < FRAME; i++) {
      const t = f * FRAME + i;
      const v = t >= START && t - START < voice.length ? voice[t - START] : 0;
      const n = c.playing && t < narr.length ? narr[t] : 0;
      const e = c.playing && t < echo.length ? echo[t] : 0;
      mic[i] = v + e + (Math.random() - .5) * 0.002;   // light self-noise
      speaker[i] = c.reference ? n * 0.6 : 0;
    }
    const playing = c.playing && f * FRAME < narr.length;
    const ev = gate.frame({ mic, speaker }, playing, true);
    if (ev && ev.kind === "onset") {
      const ms = (f * FRAME - START) / 48;
      if (ms < 0) falseOnsets++; else if (first === null) first = ms;
    }
  }
  return { detected_ms: first === null ? "MISSED" : Math.round(first), false_onsets: falseOnsets };
};

const voices = [0.01, 0.02, 0.04, 0.08];
const scenarios: [string, Omit<TCase, "voice">][] = [
  ["paused, quiet room", { echo: 0, reference: true, playing: false }],
  ["narrating, headphones (no echo)", { echo: 0, reference: true, playing: true }],
  ["narrating, speakers, browser AEC removes 90%", { echo: 0.006, reference: true, playing: true }],
  ["narrating, speakers, no AEC benefit", { echo: 0.05, reference: true, playing: true }],
  ["narrating, speakers, reference NOT connected", { echo: 0.05, reference: false, playing: true }],
];
for (const [name, base] of scenarios) {
  console.log("\n" + name);
  for (const voice of voices) {
    const h = run(Head, { ...base, voice }), n = run(Now, { ...base, voice });
    console.log(`  voice rms ${voice.toFixed(2)}  HEAD: ${String(h.detected_ms).padStart(6)} ms, false ${h.false_onsets}   NOW: ${String(n.detected_ms).padStart(6)} ms, false ${n.false_onsets}`);
  }
}
