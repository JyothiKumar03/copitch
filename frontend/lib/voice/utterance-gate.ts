import type { TAudioFrame, TGateEvent } from "../../types/vad";

// The capture worklet emits 20 ms frames. Use a 2 kHz reference for delay-tolerant echo matching.
const fingerprint = (samples: Float32Array) => {
  const reduced = new Float32Array(40);
  for (let i = 0; i < reduced.length; i++) {
    const start = Math.floor(i * samples.length / reduced.length);
    const end = Math.floor((i + 1) * samples.length / reduced.length);
    for (let k = start; k < end; k++) reduced[i] += samples[k];
    reduced[i] /= Math.max(1, end - start);
  }
  return reduced;
};

const rms = (frame: Float32Array) => Math.sqrt(frame.reduce((sum, x) => sum + x * x, 0) / frame.length);

const echoMatch = (mic: Float32Array, recent: number[]) => {
  const energy = mic.reduce((sum, x) => sum + x * x, 0);
  if (!energy) return false;
  for (let offset = 0; offset + mic.length <= recent.length; offset++) {
    let refEnergy = 0, dot = 0;
    for (let i = 0; i < mic.length; i++) {
      const ref = recent[offset + i];
      refEnergy += ref * ref;
      dot += ref * mic[i];
    }
    if (refEnergy > 0.0001 && dot * dot > 0.58 * energy * refEnergy) return true;
  }
  return false;
};

export class UtteranceGate {
  private lead: Float32Array[] = [];
  private captured: Float32Array[] = [];
  private reference: number[] = [];
  private noise = 0.003;
  private onset = 0;
  private quiet = 0;
  private tail = 0;
  private echoFrames = 0;
  private hasReference = false;

  reset() {
    this.lead = [];
    this.captured = [];
    this.reference = [];
    this.hasReference = false;
    this.onset = this.quiet = this.tail = this.echoFrames = 0;
  }

  frame({ mic, speaker }: TAudioFrame, playing: boolean): TGateEvent | undefined {
    const level = rms(mic);
    const far = rms(speaker);
    this.reference.push(...fingerprint(speaker));
    if (this.reference.length > 640) this.reference.splice(0, 40);
    this.tail = playing || far > 0.004 ? 14 : Math.max(0, this.tail - 1);
    const protectedFrame = this.tail > 0;
    if (far > 0.004) this.hasReference = true;
    if (!protectedFrame) this.hasReference = false;
    const onsetThreshold = protectedFrame ? Math.max(0.043, this.noise * 4) : Math.max(0.014, this.noise * 3);
    const threshold = this.captured.length ? Math.max(0.009, this.noise * 2) : onsetThreshold;
    const voiceBand = fingerprint(mic);
    let crossings = 0;
    for (let i = 1; i < voiceBand.length; i++) {
      if ((voiceBand[i] >= 0) !== (voiceBand[i - 1] >= 0)) crossings++;
    }
    const speechLike = crossings >= 2 && crossings <= 29 && rms(voiceBand) > 0.42 * level;
    const echo = protectedFrame && level > 0.008 && echoMatch(voiceBand, this.reference);
    const missingReference = playing && !this.hasReference;
    const voiced = level >= threshold && (this.captured.length > 0 || speechLike) && !echo && !missingReference;
    this.echoFrames = playing && (echo || missingReference) && level > 0.064 ? this.echoFrames + 1 : 0;
    if (this.echoFrames >= 65) {
      this.reset();
      return { kind: "feedback" };
    }

    if (!this.captured.length) {
      if (!protectedFrame && !voiced) this.noise = 0.98 * this.noise + 0.02 * Math.min(level, 0.020);
      // Retain quiet onsets while keeping known playback leakage out of the pre-roll.
      if (protectedFrame && !voiced) this.lead = [];
      else this.lead.push(mic);
      if (this.lead.length > 15) this.lead.shift();
      this.onset = voiced ? this.onset + 1 : 0;
      if (this.onset >= (protectedFrame ? 9 : 5)) {
        this.captured = this.lead;
        this.lead = [];
        this.quiet = 0;
        return { kind: "onset" };
      }
      return;
    }

    this.captured.push(echo ? new Float32Array(mic.length) : mic);
    this.quiet = voiced ? 0 : this.quiet + 1;
    if (this.quiet < 35 && this.captured.length < 1500) return;
    const frames = this.captured;
    this.reset();
    return { kind: "end", frames };
  }
}

export const encodeSpeechWav = (frames: Float32Array[], inputRate: number): Blob => {
  const rate = Math.min(16000, inputRate);
  const samples = new Float32Array(frames.reduce((n, frame) => n + frame.length, 0));
  let position = 0;
  for (const frame of frames) { samples.set(frame, position); position += frame.length; }
  const count = Math.floor(samples.length * rate / inputRate);
  const buffer = new ArrayBuffer(44 + count * 2);
  const view = new DataView(buffer);
  const tag = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i));
  };
  tag(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); tag(8, "WAVE"); tag(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); tag(36, "data"); view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * inputRate / rate);
    const end = Math.floor((i + 1) * inputRate / rate);
    let sum = 0;
    for (let n = start; n < end; n++) sum += samples[n];
    view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, sum / (end - start))) * 32767), true);
  }
  return new Blob([buffer], { type: "audio/wav" });
};
