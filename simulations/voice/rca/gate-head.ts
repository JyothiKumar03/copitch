type TAudioFrame = { mic: Float32Array; speaker: Float32Array };
type TGateEvent = { kind: "onset" } | { kind: "end"; frames: Float32Array[] } | { kind: "discard" } | { kind: "unavailable" };
type TEchoTap = { offset: number; gain: number; score: number };
type TEchoPath = { offset: number; frames: number };

const frameSamples = 40;
const referenceFrames = 32;
const microphoneWarmupFrames = 12;

// The capture worklet emits 20 ms frames. Use a 2 kHz reference for delay-tolerant echo matching.
const fingerprint = (samples: Float32Array) => {
  const reduced = new Float32Array(frameSamples);
  for (let i = 0; i < reduced.length; i++) {
    const start = Math.floor(i * samples.length / reduced.length);
    const end = Math.floor((i + 1) * samples.length / reduced.length);
    for (let k = start; k < end; k++) reduced[i] += samples[k];
    reduced[i] /= Math.max(1, end - start);
  }
  return reduced;
};

const rms = (frame: Float32Array) => Math.sqrt(frame.reduce((sum, x) => sum + x * x, 0) / frame.length);

// Remove DC and low-frequency device noise. Keep the filter history across frames
// so both sides of the echo comparison contain the same voice band.
const speechBand = (samples: Float32Array, baseline: number) => {
  const filtered = samples.map(sample => {
    baseline += 0.24 * (sample - baseline);
    return sample - baseline;
  });
  return { filtered, baseline };
};

const bestTap = (mic: Float32Array, reference: Float32Array, start: number, end: number): TEchoTap => {
  let best = { offset: start, gain: 0, score: 0 };
  for (let offset = start; offset <= end; offset++) {
    let refEnergy = 0, dot = 0;
    for (let i = 0; i < mic.length; i++) {
      const ref = reference[offset + i];
      refEnergy += ref * ref;
      dot += ref * mic[i];
    }
    if (refEnergy < 0.0001) continue;
    const score = dot * dot / refEnergy;
    if (score > best.score) best = { offset, gain: dot / refEnergy, score };
  }
  return best;
};

const removeTap = (mic: Float32Array, reference: Float32Array, { offset, gain }: TEchoTap) =>
  mic.map((value, index) => value - gain * reference[offset + index]);

// Estimate a direct path and a nearby reflection from the actual rendered signal.
// Judge overlap on what remains so louder speaker audio does not mask the host.
const residualVoice = (mic: Float32Array, reference: Float32Array, path?: TEchoPath) => {
  const energy = mic.reduce((sum, value) => sum + value * value, 0);
  const limit = reference.length - mic.length;
  const locked = path && path.frames >= 4;
  const direct = locked
    ? bestTap(mic, reference, Math.max(0, path.offset - 4), Math.min(limit, path.offset + 4))
    : bestTap(mic, reference, 0, limit);
  if (!energy || direct.score < energy * 0.42) return { samples: mic, echo: false, path };
  const samePath = path && Math.abs(path.offset - direct.offset) <= 4;
  const nextPath = locked || direct.score < energy * 0.7 ? path : {
    offset: direct.offset,
    frames: samePath ? path.frames + 1 : 1,
  };
  const residual = removeTap(mic, reference, direct);
  const reflection = bestTap(residual, reference, Math.max(0, direct.offset - 160), Math.min(limit, direct.offset + 160));
  return { samples: reflection.score > energy * 0.035 ? removeTap(residual, reference, reflection) : residual, echo: true, path: nextPath };
};

const withVoiceResidual = (frame: Float32Array, voiceBand: Float32Array, residual: Float32Array) => {
  const cleaned = new Float32Array(frame.length);
  for (let i = 0; i < frame.length; i++) {
    const bandIndex = Math.min(frameSamples - 1, Math.floor(i * frameSamples / frame.length));
    cleaned[i] = frame[i] - voiceBand[bandIndex] + residual[bandIndex];
  }
  return cleaned;
};

export class RoomUtteranceGate {
  private lead: Float32Array[] = [];
  private captured: Float32Array[] = [];
  private reference = new Float32Array(referenceFrames * frameSamples);
  private noise = 0.003;
  private onset: boolean[] = [];
  private quiet = 0;
  private tail = 0;
  private unavailable = 0;
  private voicedFrames = 0;
  private hasReference = false;
  private path?: TEchoPath;
  private warmup: number[] = [];
  private micBaseline = 0;
  private speakerBaseline = 0;

  reset() {
    this.lead = [];
    this.captured = [];
    this.onset = [];
    this.quiet = this.voicedFrames = 0;
  }

  frame({ mic, speaker }: TAudioFrame, playing: boolean, accepting = true): TGateEvent | undefined {
    const speakerBand = speechBand(fingerprint(speaker), this.speakerBaseline);
    this.speakerBaseline = speakerBand.baseline;
    const far = rms(speakerBand.filtered);
    const micBand = speechBand(fingerprint(mic), this.micBaseline);
    this.micBaseline = micBand.baseline;
    const voiceBand = micBand.filtered;
    const rawLevel = rms(voiceBand);
    this.reference.copyWithin(0, frameSamples);
    this.reference.set(speakerBand.filtered, this.reference.length - frameSamples);
    this.tail = playing || far > 0.003 ? referenceFrames : Math.max(0, this.tail - 1);
    const protectedFrame = this.tail > 0;
    if (far > 0.003) this.hasReference = true;
    if (!protectedFrame) this.hasReference = false;
    // Let browser capture settle before a device startup transient can pause a slide.
    if (this.warmup.length < microphoneWarmupFrames) {
      this.warmup.push(protectedFrame ? this.noise : rawLevel);
      if (this.warmup.length === microphoneWarmupFrames) {
        const quietSample = [...this.warmup].sort((a, b) => a - b)[Math.floor(microphoneWarmupFrames / 5)];
        this.noise = Math.max(this.noise, Math.min(quietSample, 0.028));
      }
      return;
    }
    if (!accepting) { this.reset(); return; }
    const onsetThreshold = protectedFrame ? Math.max(0.034, this.noise * 4) : Math.max(0.014, this.noise * 3);
    const threshold = this.captured.length ? Math.max(0.009, this.noise * 2) : onsetThreshold;
    const residual = protectedFrame && rawLevel > 0.008
      ? residualVoice(voiceBand, this.reference, this.path)
      : { samples: voiceBand, echo: false, path: this.path };
    this.path = residual.path;
    const voiceLevel = rms(residual.samples);
    const level = residual.echo ? voiceLevel : rawLevel;
    let crossings = 0;
    for (let i = 1; i < residual.samples.length; i++) {
      if ((residual.samples[i] >= 0) !== (residual.samples[i - 1] >= 0)) crossings++;
    }
    const speechLike = crossings >= 2 && crossings <= 29;
    const echoOnly = residual.echo && voiceLevel < Math.max(0.014, 0.42 * rawLevel);
    const missingReference = playing && !this.hasReference;
    const voiced = level >= threshold && speechLike && !echoOnly && !missingReference;
    this.unavailable = missingReference && rawLevel > 0.064 ? this.unavailable + 1 : 0;
    if (this.unavailable >= 65) {
      this.reset();
      return { kind: "unavailable" };
    }
    const clean = () => echoOnly || missingReference ? new Float32Array(mic.length) :
      residual.echo ? withVoiceResidual(mic, voiceBand, residual.samples) : mic;

    if (!this.captured.length) {
      if (!protectedFrame && !voiced) this.noise = 0.98 * this.noise + 0.02 * Math.min(level, 0.020);
      this.lead.push(protectedFrame && !voiced ? new Float32Array(mic.length) : clean());
      if (this.lead.length > 15) this.lead.shift();
      this.onset.push(voiced);
      if (this.onset.length > 9) this.onset.shift();
      const voicedFrames = this.onset.filter(Boolean).length;
      if (voiced && voicedFrames >= (protectedFrame ? 6 : 4)) {
        this.captured = this.lead;
        this.lead = [];
        this.quiet = 0;
        this.voicedFrames = voicedFrames;
        return { kind: "onset" };
      }
      return;
    }

    this.captured.push(clean());
    if (voiced) this.voicedFrames++;
    this.quiet = voiced ? 0 : this.quiet + 1;
    if (this.quiet < 35 && this.captured.length < 1500) return;
    const frames = this.captured;
    const enoughVoice = this.voicedFrames >= 12;
    this.reset();
    return enoughVoice ? { kind: "end", frames } : { kind: "discard" };
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
