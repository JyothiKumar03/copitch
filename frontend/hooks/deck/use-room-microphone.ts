"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { openRealtimeSpeech } from "@/lib/presentation-realtime";
import type { TRealtimeSpeechEvent } from "@/lib/presentation-realtime";
import { encodeSpeechWav, hasSpeechTranscript, matchesNarration, RoomUtteranceGate } from "@/lib/room-utterance";

type TRoomInput = {
  ready: Promise<{ context: AudioContext; microphone: MediaStream }>;
  close: () => void;
};

const microphoneOptions = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } };

const supportsRoomAudio = () => typeof AudioContext !== "undefined" && typeof AudioWorkletNode !== "undefined" &&
  !!navigator.mediaDevices?.getUserMedia;

export const prepareRoomInput = (borrowed?: MediaStream): TRoomInput => {
  let context: AudioContext | undefined;
  let microphone: MediaStream | undefined;
  let stopped = false;
  const stopMicrophone = () => {
    stopped = true;
    if (!borrowed) microphone?.getTracks().forEach(track => track.stop());
  };
  const close = () => {
    stopMicrophone();
    if (context && context.state !== "closed") void context.close().catch(() => {});
  };
  const ready = (async () => {
    if (!supportsRoomAudio()) throw new Error("Hands-free audio is unavailable in this browser.");
    const activated = context = new AudioContext();
    const resume = activated.resume();
    void resume.catch(() => {});
    microphone = borrowed ?? await navigator.mediaDevices.getUserMedia(microphoneOptions);
    if (stopped) {
      stopMicrophone();
      throw new Error("Microphone opening was cancelled.");
    }
    await resume;
    return { context: activated, microphone };
  })().catch(error => {
    close();
    throw error;
  });
  void ready.catch(() => {});
  return { ready, close };
};

type TRoomOptions = {
  anchor: string;
  revision?: number;
  ready: boolean;
  blocked: () => boolean;
  playbackExpected: boolean;
  narration?: string;
  duck: () => ((advance?: boolean) => void) | undefined;
  pin: () => Promise<string | null>;
  recover: (pinId: string, resume: boolean) => Promise<unknown>;
  transcribe: (clip: Blob, signal: AbortSignal) => Promise<string>;
  connectRealtime: (sdp: string, signal: AbortSignal) => Promise<string>;
  submit: (pinId: string, message: string) => Promise<unknown>;
};
type TRoomGraph = {
  abort: AbortController;
  microphone?: MediaStream;
  input?: MediaStreamAudioSourceNode;
  worklet?: AudioWorkletNode;
  recoverPlayback?: () => Promise<unknown>;
};
type TPlaybackAudio = { element: HTMLAudioElement; playing: boolean; source?: MediaElementAudioSourceNode };
type TRoomTake = {
  anchor: string;
  narration?: string;
  wasPlaying: boolean;
  abort: AbortController;
  unduck?: (advance?: boolean) => void;
  pin?: Promise<string | null>;
  stream?: { itemId: string; partial: string; timeout?: ReturnType<typeof setTimeout> };
};
const quietMeter = { level: 0, quietCalibrated: false, echoCalibrated: false, missingReference: false, tooQuiet: false };

const connectReference = (context: AudioContext, worklet: AudioWorkletNode, audio: TPlaybackAudio) => {
  if (!audio.source) {
    audio.source = context.createMediaElementSource(audio.element);
    audio.source.connect(context.destination);
  }
  audio.source.connect(worklet, 0, 1);
};

export const useRoomMicrophone = (options: TRoomOptions) => {
  const [status, setStatus] = useState<"off" | "opening" | "ready" | "listening" | "processing">("off");
  const [error, setError] = useState<string | null>(null);
  const [meter, setMeter] = useState(quietMeter);
  const latest = useRef(options);
  const playback = useRef<TPlaybackAudio | null>(null);
  const graph = useRef<TRoomGraph | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const loaded = useRef<Promise<void> | null>(null);
  useEffect(() => { latest.current = options; }, [options]);

  const disconnect = useCallback(() => {
    const room = graph.current;
    if (!room) return;
    room.abort.abort();
    graph.current = null;
    if (room.worklet) {
      room.worklet.port.onmessage = null;
      if (playback.current?.source) {
        try { playback.current.source.disconnect(room.worklet, 0, 1); } catch { /* Reference was unavailable. */ }
      }
      room.worklet.disconnect();
    }
    room.input?.disconnect();
    room.microphone?.getTracks().forEach(track => track.stop());
  }, []);

  const stop = () => {
    void graph.current?.recoverPlayback?.().catch(() => {});
    disconnect();
    setStatus("off");
    setMeter(quietMeter);
  };
  const microphone = () => graph.current?.microphone;
  const isCapturing = () => !!graph.current?.recoverPlayback;
  useEffect(() => () => {
    disconnect();
    playback.current?.source?.disconnect();
    if (audioContext.current) void audioContext.current.close().catch(() => {});
    audioContext.current = null;
    loaded.current = null;
  }, [disconnect]);

  const observeAudio = useCallback((element: HTMLAudioElement) => {
    const current: TPlaybackAudio = { element, playing: false };
    playback.current = current;
    const started = () => { current.playing = true; };
    const stopped = () => { current.playing = false; };
    element.addEventListener("playing", started);
    element.addEventListener("pause", stopped);
    element.addEventListener("waiting", stopped);
    element.addEventListener("ended", stopped);
    const context = audioContext.current;
    const worklet = graph.current?.worklet;
    if (context && worklet) {
      try { connectReference(context, worklet, current); } catch { /* Narration stays available without room capture. */ }
    }
    return () => {
      element.removeEventListener("playing", started);
      element.removeEventListener("pause", stopped);
      element.removeEventListener("waiting", stopped);
      element.removeEventListener("ended", stopped);
      current.source?.disconnect();
      if (playback.current === current) playback.current = null;
    };
  }, []);

  const start = useCallback(async () => {
    if (graph.current) return;
    if (!supportsRoomAudio()) {
      setError("Hands-free audio is unavailable in this browser. You can type your question."); return;
    }
    const room = { abort: new AbortController() } as TRoomGraph;
    graph.current = room;
    setError(null);
    setStatus("opening");
    try {
      const context = audioContext.current ?? new AudioContext();
      audioContext.current = context;
      const resume = context.resume();
      void resume.catch(() => {});
      const media = await navigator.mediaDevices.getUserMedia(microphoneOptions);
      if (room.abort.signal.aborted) { media.getTracks().forEach(track => track.stop()); return; }
      room.microphone = media;
      for (const track of media.getAudioTracks()) track.addEventListener("ended", () => {
        if (room.abort.signal.aborted) return;
        void room.recoverPlayback?.().catch(() => {});
        disconnect();
        setStatus("off");
        setMeter(quietMeter);
        setError("The room microphone disconnected. Hold to talk or type your question.");
      }, { once: true });
      await resume;
      loaded.current ??= context.audioWorklet.addModule("/voice/presentation-capture.js");
      await loaded.current;
      if (room.abort.signal.aborted) return;
      room.worklet = new AudioWorkletNode(context, "presentation-capture", { numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [1] });
      room.input = context.createMediaStreamSource(media);
      room.input.connect(room.worklet);
      if (playback.current) {
        try { connectReference(context, room.worklet, playback.current); } catch { /* Continue with the calibrated fallback. */ }
      }
      room.worklet.connect(context.destination);
      const debugging = new URLSearchParams(window.location.search).get("debug") === "voice";
      const gate = new RoomUtteranceGate(debugging ? detail => console.debug("[presentation voice]", detail) : undefined);
      const trace = (event: string) => { if (debugging) console.debug("[presentation voice]", { event }); };
      let take: TRoomTake | null = null;
      let busy = false;
      let realtime: Awaited<ReturnType<typeof openRealtimeSpeech>> | undefined;
      const revision = latest.current.revision;
      let meterFrames = 0;
      let quietFrames = 0;
      let quietHintFrames = 0;
      const cancelTake = (advance: boolean) => {
        if (!take) return;
        clearTimeout(take.stream?.timeout);
        take.abort.abort();
        take.unduck?.(advance);
        take = null;
        room.recoverPlayback = undefined;
        gate.reset();
        setStatus("ready");
      };
      const beginTake = (current: TRoomOptions, stream?: TRoomTake["stream"]) => {
        const candidate: TRoomTake = {
          anchor: current.anchor, narration: current.playbackExpected ? current.narration : undefined,
          wasPlaying: current.playbackExpected, abort: new AbortController(),
          unduck: current.playbackExpected ? current.duck() : undefined,
          stream,
        };
        take = candidate;
        room.recoverPlayback = async () => {
          clearTimeout(candidate.stream?.timeout);
          candidate.abort.abort();
          const pinId = await candidate.pin;
          candidate.unduck?.(!pinId);
          if (pinId) await current.recover(pinId, candidate.wasPlaying);
        };
        setStatus("listening");
        quietHintFrames = 0;
      };
      const finishTake = async (recorded: TRoomTake, current: TRoomOptions, transcript: (signal: AbortSignal) => Promise<string>) => {
        clearTimeout(recorded.stream?.timeout);
        take = null;
        busy = true;
        setStatus("processing");
        let pinId: string | null = null;
        let submitted = false;
        const isCurrent = () => !room.abort.signal.aborted && !recorded.abort.signal.aborted && recorded.anchor === latest.current.anchor;
        try {
          if (!isCurrent()) return;
          const text = (await transcript(AbortSignal.any([room.abort.signal, recorded.abort.signal]))).trim();
          if (!isCurrent() || !hasSpeechTranscript(text)) return;
          if (recorded.narration && matchesNarration(text, recorded.narration)) {
            trace("echo-transcript-rejected");
            return;
          }
          recorded.pin = current.pin();
          pinId = await recorded.pin;
          if (!pinId || !isCurrent()) return;
          recorded.unduck?.(false);
          submitted = !!await current.submit(pinId, text.slice(0, 2000));
        } catch (cause) {
          if (isCurrent()) setError(cause instanceof Error ? cause.message : "Could not use the room microphone.");
        } finally {
          recorded.unduck?.(!pinId);
          if (pinId && isCurrent() && !submitted) await current.recover(pinId, recorded.wasPlaying).catch(() => {});
          room.recoverPlayback = undefined;
          busy = false;
          if (!room.abort.signal.aborted) setStatus("ready");
        }
      };
      const fallbackToWav = () => {
        trace("realtime-fallback");
        realtime?.close();
        realtime = undefined;
        if (take?.stream) {
          cancelTake(true);
          setError("Realtime speech disconnected. Ask again or hold to talk.");
        }
      };
      const onRealtimeSpeech = (event: TRealtimeSpeechEvent) => {
        if (!realtime || room.abort.signal.aborted) return;
        const current = latest.current;
        if (event.kind === "started") {
          if (!busy && !take && current.ready && !current.blocked() && current.revision === revision) {
            trace("realtime-speech-started");
            beginTake(current, { itemId: event.itemId, partial: "", timeout: setTimeout(fallbackToWav, 29_000) });
          }
          return;
        }
        const stream = take?.stream;
        if (!take || !stream || stream.itemId !== event.itemId || take.anchor !== current.anchor) return;
        if (event.kind === "stopped") {
          clearTimeout(stream.timeout);
          stream.timeout = setTimeout(fallbackToWav, 4000);
          setStatus("processing");
        } else if (event.kind === "delta") {
          stream.partial = (stream.partial + event.text).slice(0, 2000);
          if (take.narration && matchesNarration(stream.partial, take.narration)) trace("realtime-partial-matches-narration");
        } else if (event.kind === "completed") {
          void finishTake(take, current, async () => event.text);
        } else if (event.kind === "failed") {
          fallbackToWav();
        }
      };
      const track = media.getAudioTracks()[0];
      if (track && typeof RTCPeerConnection !== "undefined") {
        void openRealtimeSpeech(track, room.abort.signal, latest.current.connectRealtime, onRealtimeSpeech, fallbackToWav).then(connection => {
          if (room.abort.signal.aborted || latest.current.revision !== revision) { connection.close(); return; }
          realtime = connection;
          trace("realtime-connected");
        }).catch(() => { if (!room.abort.signal.aborted) fallbackToWav(); });
      }
      room.abort.signal.addEventListener("abort", () => clearTimeout(take?.stream?.timeout), { once: true });
      room.worklet.port.onmessage = ({ data }) => {
        if (room.abort.signal.aborted) return;
        const current = latest.current;
        if (take && take.anchor !== current.anchor) cancelTake(false);
        if (realtime && current.revision !== revision) {
          realtime.close();
          realtime = undefined;
          trace("realtime-revision-changed");
        }
        if (!(data?.mic instanceof Float32Array) || !(data?.speaker instanceof Float32Array)) return;
        const playing = !!playback.current?.playing && !playback.current.element.paused;
        const canStart = current.ready && !current.blocked();
        const recordingWav = !!take && !take.stream;
        realtime?.listen(!busy && !recordingWav && canStart);
        const event = gate.frame(data, playing, !busy && (recordingWav || !realtime && canStart));
        quietFrames = gate.meter.tooQuiet ? quietFrames + 1 : Math.max(0, quietFrames - 1);
        quietHintFrames = event?.kind === "onset" ? 0 : quietFrames >= 15 ? 100 : Math.max(0, quietHintFrames - 1);
        if (++meterFrames % 5 === 0) setMeter({ ...gate.meter, tooQuiet: quietHintFrames > 0 });
        if (event?.kind === "onset") beginTake(current);
        else if (event?.kind === "discard") cancelTake(true);
        else if (event?.kind === "end" && take) {
          void finishTake(take, current, signal => current.transcribe(encodeSpeechWav(event.frames, context.sampleRate), signal));
        }
      };
      setStatus("ready");
    } catch {
      if (room.abort.signal.aborted) return;
      loaded.current = null;
      disconnect();
      setStatus("off");
      setMeter(quietMeter);
      setError("Could not start the microphone. Check your browser permission or type your question.");
    }
  }, [disconnect]);

  return { clearError: () => setError(null), error, isCapturing, meter, microphone, observeAudio, start, status, stop };
};
