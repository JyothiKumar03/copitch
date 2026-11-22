"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { encodeSpeechWav, hasSpeechTranscript } from "@/lib/room-utterance";
import { prepareRoomInput } from "./use-room-microphone";

type THoldOptions = {
  anchor: string;
  wasPlaying: boolean;
  microphone: () => MediaStream | undefined;
  pin: () => Promise<string | null>;
  recover: (pinId: string, resume: boolean) => Promise<unknown>;
  transcribe: (clip: Blob, signal: AbortSignal) => Promise<string>;
  submit: (pinId: string, message: string) => Promise<unknown>;
};

type TTake = {
  anchor: string;
  abort: AbortController;
  frames: Float32Array[];
  sampleRate: number;
  close: () => void;
  pin: Promise<string | null>;
  recover: THoldOptions["recover"];
  wasPlaying: boolean;
  timer?: number;
  released: boolean;
};

const maxRecordingMs = 29_000;

export const useHoldToTalk = (options: THoldOptions) => {
  const [status, setStatus] = useState<"idle" | "listening" | "processing">("idle");
  const [error, setError] = useState<string | null>(null);
  const take = useRef<TTake | null>(null);
  const latest = useRef(options);
  useEffect(() => { latest.current = options; }, [options]);

  const clearCapture = useCallback((recording: TTake) => {
    window.clearTimeout(recording.timer);
    recording.close();
  }, []);
  const abandon = useCallback(() => {
    const recording = take.current;
    if (!recording) return;
    take.current = null;
    recording.abort.abort();
    clearCapture(recording);
  }, [clearCapture]);

  useEffect(() => abandon, [abandon]);
  useEffect(() => {
    if (take.current && take.current.anchor !== options.anchor) {
      abandon();
      setStatus("idle");
    }
  }, [abandon, options.anchor]);

  const isActive = useCallback(() => take.current !== null, []);
  const finish = useCallback(async (send: boolean, failure?: string) => {
    const recording = take.current;
    if (!recording || recording.released) return;
    recording.released = true;
    clearCapture(recording);
    setStatus("processing");
    const isCurrent = () => take.current === recording && recording.anchor === latest.current.anchor;
    const recover = async (pinId: string) => {
      if (isCurrent()) await recording.recover(pinId, recording.wasPlaying);
    };
    try {
      if (failure && isCurrent()) setError(failure);
      const pinId = await recording.pin;
      if (!pinId || !isCurrent()) return;
      if (!send) { await recover(pinId); return; }
      if (recording.frames.length < 5) {
        setError("No speech was recorded. Hold to talk again or type your question.");
        await recover(pinId);
        return;
      }
      try {
        const clip = encodeSpeechWav(recording.frames, recording.sampleRate);
        const text = await latest.current.transcribe(clip, recording.abort.signal);
        if (!isCurrent()) return;
        if (hasSpeechTranscript(text)) {
          const result = await latest.current.submit(pinId, text.slice(0, 2000));
          if (result) return;
        } else setError("No speech was recognized. Try again or type your question.");
      } catch (cause) {
        if (isCurrent()) setError(cause instanceof Error ? cause.message : "Could not transcribe the recording.");
      }
      await recover(pinId);
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : "Could not restore presentation playback.");
    } finally {
      if (take.current === recording) {
        take.current = null;
        setStatus("idle");
      }
    }
  }, [clearCapture]);

  const start = useCallback(() => {
    if (take.current) return;
    const current = latest.current;
    const pin = current.pin();
    const input = prepareRoomInput(current.microphone());
    const recording: TTake = {
      anchor: current.anchor, abort: new AbortController(), frames: [], sampleRate: 0, close: input.close,
      pin, recover: current.recover, wasPlaying: current.wasPlaying, released: false,
    };
    take.current = recording;
    setError(null);
    setStatus("listening");
    recording.timer = window.setTimeout(() => { void finish(true); }, maxRecordingMs);
    const isRecording = () => take.current === recording && !recording.released;
    const open = async () => {
      const { context, microphone } = await input.ready;
      if (!isRecording()) return;
      await context.audioWorklet.addModule("/voice/presentation-capture.js");
      if (!isRecording()) return;
      recording.sampleRate = context.sampleRate;
      const worklet = new AudioWorkletNode(context, "presentation-capture", { numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [1] });
      const source = context.createMediaStreamSource(microphone);
      const track = microphone.getAudioTracks()[0];
      const disconnected = () => { void finish(false, "The microphone disconnected. Type your question or try again."); };
      track.addEventListener("ended", disconnected);
      recording.close = () => {
        track.removeEventListener("ended", disconnected);
        worklet.port.onmessage = null;
        source.disconnect();
        worklet.disconnect();
        input.close();
      };
      worklet.port.onmessage = ({ data }) => {
        if (isRecording() && data?.mic instanceof Float32Array) recording.frames.push(data.mic);
      };
      source.connect(worklet);
      worklet.connect(context.destination);
    };
    void open().catch(() => {
      if (isRecording()) void finish(false, "Could not record. Check microphone permission or type your question.");
    });
  }, [finish]);

  return { clearError: () => setError(null), error, finish, isActive, start, status };
};
