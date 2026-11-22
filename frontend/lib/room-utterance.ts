type TAudioFrame = { mic: Float32Array; speaker: Float32Array };
type TGateEvent = { kind: "onset" } | { kind: "end"; frames: Float32Array[] } | { kind: "discard" };
type TGateDiagnostic = {
  event: "onset" | "echo-only" | "missing-reference" | "unavailable" | "quiet-calibrated" | "echo-calibrated";
  micLevel: number; speakerLevel: number; voiceLevel: number; threshold: number;
};
type TEchoTap = { offset: number; gain: number; score: number };
type TEchoPath = { offset: number; frames: number };
type TRoomTap = Pick<TEchoTap, "gain"> & { lag: number };

const frameSamples = 40;
const referenceFrames = 32;
const microphoneWarmupFrames = 12;
const calibrationFrames = 75;
const trainingFrames = 24;
const percentile = (levels: number[], fraction: number) =>
  [...levels].sort((a, b) => a - b)[Math.floor((levels.length - 1) * fraction)];

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

// Fit stable reflections across several frames. Per-frame matches alone can confuse loud room echo with speech.
const learnRoom = (mic: Float32Array, reference: Float32Array): TRoomTap[] | undefined => {
  const limit = reference.length - mic.length;
  const energy = mic.reduce((sum, sample) => sum + sample * sample, 0);
  if (energy < 0.001) return;
  const direct = bestTap(mic, reference, 0, limit);
  if (direct.score < energy * 0.45) return;
  const gains = new Map([[direct.offset, direct.gain]]);
  const residual = removeTap(mic, reference, direct);
  for (let index = 0; index < 10; index++) {
    const tap = bestTap(residual, reference, Math.max(0, direct.offset - 160), Math.min(limit, direct.offset + 16));
    if (tap.score < energy * 0.00004) break;
    gains.set(tap.offset, (gains.get(tap.offset) ?? 0) + tap.gain);
    for (let sample = 0; sample < residual.length; sample++) residual[sample] -= tap.gain * reference[tap.offset + sample];
    for (const [offset, gain] of gains) {
      const correction = bestTap(residual, reference, offset, offset).gain;
      if (!correction) continue;
      gains.set(offset, gain + correction);
      for (let sample = 0; sample < residual.length; sample++) residual[sample] -= correction * reference[offset + sample];
    }
  }
  if (residual.reduce((sum, sample) => sum + sample * sample, 0) > energy * 0.025) return;
  return Array.from(gains, ([offset, gain]) => ({ lag: limit - offset, gain }));
};

const removeRoom = (mic: Float32Array, reference: Float32Array, taps: TRoomTap[]) => {
  const limit = reference.length - mic.length;
  const predicted = mic.map((_, index) => taps.reduce((value, { lag, gain }) =>
    value + reference[limit - lag + index] * gain, 0));
  const energy = predicted.reduce((sum, value) => sum + value * value, 0);
  if (energy < 0.00005) return;
  const dot = predicted.reduce((sum, value, index) => sum + value * mic[index], 0);
  const scale = Math.min(4, Math.max(0, dot / energy));
  if (scale < 0.07) return;
  return mic.map((value, index) => value - predicted[index] * scale);
};

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
  private reference = new Float32Array((referenceFrames + trainingFrames) * frameSamples);
  private noise = 0.001;
  private echoFloor = 0;
  private onset: boolean[] = [];
  private quiet = 0;
  private tail = 0;
  private silentReferenceFrames = 0;
  private missingReferenceFrames = 0;
  private voicedFrames = 0;
  private seenFrames = 0;
  private hasReference = false;
  private path?: TEchoPath;
  private room?: TRoomTap[];
  private roomSample = new Float32Array(trainingFrames * frameSamples);
  private quietSample: number[] = [];
  private echoSample: number[] = [];
  private micBaseline = 0;
  private speakerBaseline = 0;
  meter = { level: 0, quietCalibrated: false, echoCalibrated: false, missingReference: false, tooQuiet: false };

  constructor(private readonly report?: (diagnostic: TGateDiagnostic) => void) {}

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
    this.silentReferenceFrames = far > 0.003 ? 0 : this.silentReferenceFrames + 1;
    if (far > 0.003) this.hasReference = true;
    else if (!protectedFrame || this.silentReferenceFrames >= 35) { this.hasReference = false; this.path = undefined; }
    this.roomSample.copyWithin(0, frameSamples);
    this.roomSample.set(voiceBand, this.roomSample.length - frameSamples);
    if (playing && this.hasReference && this.echoSample.length >= 15 && this.echoSample.length % 8 === 7 &&
        this.echoSample.length < calibrationFrames && !this.captured.length) {
      this.room = learnRoom(this.roomSample, this.reference) ?? this.room;
    }
    const cleanRoom = protectedFrame && this.hasReference && this.room && removeRoom(voiceBand, this.reference, this.room);
    const residual = protectedFrame && this.hasReference && rawLevel > 0.006
      ? cleanRoom ? { samples: cleanRoom, echo: true, path: this.path } : residualVoice(voiceBand, this.reference, this.path)
      : { samples: voiceBand, echo: false, path: this.path };
    this.path = residual.path;
    const voiceLevel = rms(residual.samples);
    const level = residual.echo ? voiceLevel : rawLevel;
    let crossings = 0;
    for (let i = 1; i < residual.samples.length; i++) {
      if ((residual.samples[i] >= 0) !== (residual.samples[i - 1] >= 0)) crossings++;
    }
    const speechLike = crossings >= 2 && crossings <= 29;
    const echoOnly = residual.echo && voiceLevel < Math.max(0.004, 0.16 * rawLevel);
    const missingReference = playing && !this.hasReference;
    if (!protectedFrame && !this.captured.length && this.quietSample.length < calibrationFrames) {
      this.quietSample.push(rawLevel);
      if (this.quietSample.length % 12 === 0 || this.quietSample.length === calibrationFrames) {
        this.noise = Math.max(0.001, Math.min(percentile(this.quietSample, 0.25), 0.028));
      }
      if (this.quietSample.length === calibrationFrames) {
        this.report?.({ event: "quiet-calibrated", micLevel: this.noise, speakerLevel: far, voiceLevel, threshold: this.noise * 3 });
      }
    }
    if (playing && !this.captured.length && this.echoSample.length < calibrationFrames) {
      this.echoSample.push(echoOnly ? 0 : level);
      if (this.echoSample.length % 15 === 0) this.echoFloor = percentile(this.echoSample, missingReference ? 0.85 : 0.55);
      if (this.echoSample.length === calibrationFrames) {
        this.report?.({ event: "echo-calibrated", micLevel: rawLevel, speakerLevel: this.echoFloor, voiceLevel, threshold: this.echoFloor * 2.5 });
      }
    }
    const onsetThreshold = Math.max(0.006, this.noise * 3, protectedFrame ? 2.5 * this.echoFloor : 0);
    const threshold = this.captured.length ? Math.max(0.004, this.noise * 2, protectedFrame ? this.echoFloor : 0) : onsetThreshold;
    const voiced = level >= threshold && speechLike && !echoOnly;
    this.missingReferenceFrames = missingReference ? this.missingReferenceFrames + 1 : 0;
    this.meter = {
      level: rawLevel, quietCalibrated: this.quietSample.length >= calibrationFrames,
      echoCalibrated: this.echoSample.length >= calibrationFrames, missingReference: this.missingReferenceFrames >= 35,
      tooQuiet: !echoOnly && speechLike && level < onsetThreshold && level >= Math.max(0.003, this.noise * 1.8),
    };
    const report = (event: TGateDiagnostic["event"]) => this.report?.({ event, micLevel: rawLevel, speakerLevel: far, voiceLevel, threshold });
    if (this.missingReferenceFrames === 1) report("missing-reference");
    if (this.missingReferenceFrames === 65) report("unavailable");
    if (echoOnly && rawLevel >= threshold) report("echo-only");
    const missingReferenceSettling = missingReference && this.missingReferenceFrames < 15;
    const learningRoom = playing && this.hasReference && !this.room && this.echoSample.length < calibrationFrames && level < 0.024;
    if (++this.seenFrames <= microphoneWarmupFrames || !accepting ||
        !this.captured.length && (missingReferenceSettling || learningRoom)) { this.reset(); return; }
    const clean = () => echoOnly ? new Float32Array(mic.length) :
      residual.echo ? withVoiceResidual(mic, voiceBand, residual.samples) : mic;

    if (!this.captured.length) {
      if (!protectedFrame && !voiced) this.noise = 0.98 * this.noise + 0.02 * Math.min(level, 0.020);
      this.lead.push(protectedFrame && !voiced ? new Float32Array(mic.length) : clean());
      if (this.lead.length > 15) this.lead.shift();
      this.onset.push(voiced);
      if (this.onset.length > 9) this.onset.shift();
      const voicedFrames = this.onset.filter(Boolean).length;
      if (voiced && voicedFrames >= 4) {
        this.captured = this.lead;
        this.lead = [];
        this.quiet = 0;
        this.voicedFrames = voicedFrames;
        report("onset");
        return { kind: "onset" };
      }
      return;
    }

    this.captured.push(clean());
    if (voiced) this.voicedFrames++;
    this.quiet = voiced ? 0 : this.quiet + 1;
    if (this.quiet < 25 && this.captured.length < 1450) return;
    const frames = this.captured;
    const enoughVoice = this.voicedFrames >= 10;
    this.reset();
    return enoughVoice ? { kind: "end", frames } : { kind: "discard" };
  }
}

const emptyTranscript = /^(?:um+|uh+|hmm+|ah+|thanks for watching|thank you for watching|subtitles by.*)[.!,?\s]*$/iu;

export const hasSpeechTranscript = (text: string) => /[\p{L}\p{N}]/u.test(text) && !emptyTranscript.test(text);

const wordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });
const speechWords = (text: string) => Array.from(wordSegmenter.segment(text.normalize("NFKC").toLowerCase()), item =>
  item.isWordLike ? item.segment : "").filter(Boolean);

export const matchesNarration = (transcript: string, narration: string) => {
  const heard = speechWords(transcript);
  const spoken = speechWords(narration);
  if (!heard.length || !spoken.length) return false;
  if (heard.length === 1) return spoken.length === 1 && heard[0] === spoken[0];
  if (heard.length === 2) return spoken.some((word, index) => word === heard[0] && spoken[index + 1] === heard[1]);
  const remaining = [...spoken];
  let matched = 0;
  for (const word of heard) {
    const index = remaining.indexOf(word);
    if (index < 0) continue;
    matched++;
    remaining.splice(index, 1);
  }
  return matched / heard.length >= 0.6;
};

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
