import { UtteranceGate, encodeSpeechWav } from "./utterance-gate";
import type { TAudioFrame, TCaptureCallbacks, THandsFreeCapture } from "../../types/vad";

export const openHandsFree = async (signal: AbortSignal, callbacks: TCaptureCallbacks): Promise<THandsFreeCapture> => {
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined" || typeof AudioWorkletNode === "undefined") {
    throw new Error("Hands-free listening is unavailable in this browser. Use Talk or type your message.");
  }
  const context = new AudioContext();
  const gate = new UtteranceGate();
  let stream: MediaStream | undefined;
  let mic: MediaStreamAudioSourceNode | undefined;
  let processor: AudioWorkletNode | undefined;
  let closed = false;
  const lost = () => {
    if (!closed) callbacks.onFailure("The microphone connection was interrupted. Enable hands-free again, use Talk or type.");
  };
  const close = () => {
    if (closed) return;
    closed = true;
    signal.removeEventListener("abort", close);
    context.onstatechange = null;
    if (processor) {
      processor.onprocessorerror = null;
      processor.port.onmessage = null;
      processor.port.close();
      processor.disconnect();
    }
    mic?.disconnect();
    for (const track of stream?.getTracks() ?? []) {
      track.removeEventListener("ended", lost);
      track.removeEventListener("mute", lost);
      track.stop();
    }
    gate.reset();
    void context.close().catch(() => {});
  };
  signal.addEventListener("abort", close, { once: true });
  try {
    signal.throwIfAborted();
    await context.resume();
    signal.throwIfAborted();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
    if (signal.aborted) {
      stream.getTracks().forEach(track => track.stop());
      signal.throwIfAborted();
    }
    await context.audioWorklet.addModule("/voice/interview-capture.js");
    signal.throwIfAborted();
    mic = context.createMediaStreamSource(stream);
    processor = new AudioWorkletNode(context, "interview-capture", {
      numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: "explicit",
    });
    mic.connect(processor, 0, 0);
    processor.connect(context.destination);
    processor.onprocessorerror = lost;
    context.onstatechange = () => { if (context.state !== "running") lost(); };
    for (const track of stream.getAudioTracks()) {
      track.addEventListener("ended", lost);
      track.addEventListener("mute", lost);
    }
    processor.port.onmessage = ({ data }: MessageEvent<TAudioFrame>) => {
      if (closed) return;
      if (callbacks.blocked()) { gate.reset(); return; }
      const event = gate.frame(data, callbacks.playing());
      if (event?.kind === "onset") callbacks.onStart();
      if (event?.kind === "end") callbacks.onEnd(encodeSpeechWav(event.frames, context.sampleRate));
      if (event?.kind === "feedback") callbacks.onFailure("The microphone is picking up loud speaker playback. Use headphones, Talk or typed input.");
    };
    return {
      attachPlayer: audio => {
        if (closed || !processor) throw new Error("Microphone connection closed");
        const source = context.createMediaElementSource(audio);
        source.connect(context.destination);
        source.connect(processor, 0, 1);
        return () => source.disconnect();
      },
      reset: () => gate.reset(), close,
    };
  } catch (error) {
    close();
    throw error;
  }
};
