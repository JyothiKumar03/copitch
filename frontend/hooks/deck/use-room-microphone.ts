"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { encodeSpeechWav, RoomUtteranceGate } from "@/lib/room-utterance";

type TRoomInput = {
  ready: Promise<{ context: AudioContext; microphone: MediaStream }>;
  stopMicrophone: () => void;
  close: () => void;
};

const microphoneOptions = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1 } };

const supportsRoomAudio = () => typeof AudioContext !== "undefined" && typeof AudioWorkletNode !== "undefined" &&
  !!navigator.mediaDevices?.getUserMedia;

export const prepareRoomInput = (): TRoomInput => {
  let context: AudioContext | undefined;
  let microphone: MediaStream | undefined;
  let stopped = false;
  const stopMicrophone = () => {
    stopped = true;
    microphone?.getTracks().forEach(track => track.stop());
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
    microphone = await navigator.mediaDevices.getUserMedia(microphoneOptions);
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
  return { ready, stopMicrophone, close };
};

type TRoomOptions = {
  anchor: string;
  ready: boolean;
  playbackExpected: boolean;
  pin: () => Promise<string | null>;
  resumeAfterNoise: (pinId: string) => Promise<unknown>;
  transcribe: (clip: Blob, signal: AbortSignal) => Promise<string>;
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
const emptyTranscript = /^(?:um+|uh+|hmm+|ah+|thanks for watching|thank you for watching|subtitles by.*)[.!,?\s]*$/iu;

const connectReference = (context: AudioContext, worklet: AudioWorkletNode, audio: TPlaybackAudio) => {
  if (!audio.source) {
    audio.source = context.createMediaElementSource(audio.element);
    audio.source.connect(context.destination);
  }
  audio.source.connect(worklet, 0, 1);
};

export const useRoomMicrophone = (options: TRoomOptions, prepared: TRoomInput | null) => {
  const [status, setStatus] = useState<"off" | "opening" | "ready" | "listening" | "processing">(prepared ? "opening" : "off");
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(options);
  const playback = useRef<TPlaybackAudio | null>(null);
  const graph = useRef<TRoomGraph | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const loaded = useRef<Promise<void> | null>(null);
  const dismissed = useRef(false);
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
    dismissed.current = true;
    prepared?.stopMicrophone();
    void graph.current?.recoverPlayback?.().catch(() => {});
    disconnect();
    setStatus("off");
  };
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

  const start = useCallback(async (initial?: TRoomInput) => {
    if (graph.current) return;
    if (!supportsRoomAudio()) {
      setError("Hands-free audio is unavailable in this browser. You can type your question."); return;
    }
    const room = { abort: new AbortController() } as TRoomGraph;
    graph.current = room;
    setError(null);
    setStatus("opening");
    try {
      const opened = initial && await initial.ready;
      const context = opened?.context ?? audioContext.current ?? new AudioContext();
      if (room.abort.signal.aborted) return;
      audioContext.current = context;
      if (!opened) await context.resume();
      const media = opened?.microphone ?? await navigator.mediaDevices.getUserMedia(microphoneOptions);
      if (room.abort.signal.aborted) { media.getTracks().forEach(track => track.stop()); return; }
      room.microphone = media;
      loaded.current ??= context.audioWorklet.addModule("/voice/presentation-capture.js");
      await loaded.current;
      if (room.abort.signal.aborted) return;
      room.worklet = new AudioWorkletNode(context, "presentation-capture", { numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [1] });
      room.input = context.createMediaStreamSource(media);
      room.input.connect(room.worklet);
      if (playback.current) connectReference(context, room.worklet, playback.current);
      room.worklet.connect(context.destination);
      const gate = new RoomUtteranceGate();
      let take: { anchor: string; pin: Promise<string | null>; wasPlaying: boolean } | null = null;
      let busy = false;
      room.worklet.port.onmessage = ({ data }) => {
        if (room.abort.signal.aborted) return;
        const current = latest.current;
        if (take && take.anchor !== current.anchor) { take = null; room.recoverPlayback = undefined; gate.reset(); setStatus("ready"); }
        if (!(data?.mic instanceof Float32Array) || !(data?.speaker instanceof Float32Array)) return;
        const playing = !!playback.current?.playing && !playback.current.element.paused;
        const canStart = current.ready && (!current.playbackExpected || playing);
        const event = gate.frame(data, playing, !busy && (!!take || canStart));
        if (event?.kind === "unavailable") {
          disconnect(); setStatus("off"); setError("Hands-free interruption lost its speaker reference. Type your question or turn the microphone back on.");
        } else if (event?.kind === "onset") {
          const pin = current.pin();
          take = { anchor: current.anchor, pin, wasPlaying: playing };
          if (playing) room.recoverPlayback = async () => {
            const pinId = await pin;
            if (pinId) await current.resumeAfterNoise(pinId);
          };
          setStatus("listening");
        } else if ((event?.kind === "end" || event?.kind === "discard") && take) {
          const recorded = take;
          take = null;
          busy = true;
          setStatus("processing");
          const send = async () => {
            try {
              const pinId = await recorded.pin;
              const isCurrent = () => !room.abort.signal.aborted && recorded.anchor === latest.current.anchor;
              if (!pinId || !isCurrent()) return;
              if (event.kind === "discard") {
                if (recorded.wasPlaying) await current.resumeAfterNoise(pinId);
                return;
              }
              const text = await current.transcribe(encodeSpeechWav(event.frames, context.sampleRate), room.abort.signal);
              if (!isCurrent()) return;
              if (/[\p{L}\p{N}]/u.test(text) && !emptyTranscript.test(text)) {
                room.recoverPlayback = undefined;
                await current.submit(pinId, text.slice(0, 2000));
              }
              else if (recorded.wasPlaying) await current.resumeAfterNoise(pinId);
            } catch (cause) {
              if (!room.abort.signal.aborted) {
                setError(cause instanceof Error ? cause.message : "Could not use the room microphone.");
                await room.recoverPlayback?.().catch(() => {});
              }
            } finally {
              room.recoverPlayback = undefined;
              busy = false;
              if (!room.abort.signal.aborted) setStatus("ready");
            }
          };
          void send();
        }
      };
      setStatus("ready");
    } catch {
      if (room.abort.signal.aborted) return;
      loaded.current = null;
      disconnect();
      setStatus("off");
      setError("Could not start the microphone. Check your browser permission or type your question.");
    }
  }, [disconnect]);

  useEffect(() => {
    if (!prepared) return;
    let mounted = true;
    const attach = () => { if (mounted && !dismissed.current) void start(prepared); };
    void prepared.ready.then(attach, attach);
    return () => { mounted = false; };
  }, [prepared, start]);

  return { error, observeAudio, start, status, stop };
};
