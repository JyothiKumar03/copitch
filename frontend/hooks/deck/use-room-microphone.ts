"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { encodeSpeechWav, RoomUtteranceGate } from "@/lib/room-utterance";

type TRoomOptions = {
  anchor: string;
  ready: boolean;
  pin: () => Promise<string | null>;
  resumeAfterNoise: (pinId: string) => Promise<unknown>;
  transcribe: (clip: Blob, signal: AbortSignal) => Promise<string>;
  submit: (pinId: string, message: string) => Promise<unknown>;
};
type TRoomGraph = { abort: AbortController; microphone?: MediaStream; input?: MediaStreamAudioSourceNode; worklet?: AudioWorkletNode };
type TPlaybackAudio = { element: HTMLAudioElement; source?: MediaElementAudioSourceNode };
const emptyTranscript = /^(?:um+|uh+|hmm+|ah+|thanks for watching|thank you for watching|subtitles by.*)[.!,?\s]*$/iu;

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

  const stop = () => { disconnect(); setStatus("off"); };
  useEffect(() => () => {
    disconnect();
    playback.current?.source?.disconnect();
    if (audioContext.current) void audioContext.current.close().catch(() => {});
    audioContext.current = null;
    loaded.current = null;
  }, [disconnect]);

  const observeAudio = useCallback((element: HTMLAudioElement) => {
    const current: TPlaybackAudio = { element };
    playback.current = current;
    const context = audioContext.current;
    const worklet = graph.current?.worklet;
    if (context && worklet) {
      try { connectReference(context, worklet, current); } catch { /* Narration stays available without room capture. */ }
    }
    return () => {
      current.source?.disconnect();
      if (playback.current === current) playback.current = null;
    };
  }, []);

  const start = async () => {
    if (graph.current) return;
    if (typeof AudioContext === "undefined" || typeof AudioWorkletNode === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Hands-free audio is unavailable in this browser. Use Talk or type your question."); return;
    }
    const room = { abort: new AbortController() } as TRoomGraph;
    graph.current = room;
    setError(null);
    setStatus("opening");
    try {
      const context = audioContext.current ?? new AudioContext();
      audioContext.current = context;
      await context.resume();
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
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
        if (busy || room.abort.signal.aborted) return;
        const current = latest.current;
        if (take && take.anchor !== current.anchor) { take = null; gate.reset(); setStatus("ready"); }
        if (!take && !current.ready) { gate.reset(); return; }
        if (!(data?.mic instanceof Float32Array) || !(data?.speaker instanceof Float32Array)) return;
        const playing = !!playback.current && !playback.current.element.paused;
        const event = gate.frame(data, playing);
        if (event?.kind === "feedback") {
          disconnect(); setStatus("off"); setError("The microphone is picking up the speakers. Try headphones, Talk, or typing.");
        } else if (event?.kind === "onset") {
          take = { anchor: current.anchor, pin: current.pin(), wasPlaying: playing };
          setStatus("listening");
        } else if (event?.kind === "end" && take) {
          const recorded = take;
          take = null;
          busy = true;
          setStatus("processing");
          const send = async () => {
            try {
              const pinId = await recorded.pin;
              const isCurrent = () => !room.abort.signal.aborted && recorded.anchor === latest.current.anchor;
              if (!pinId || !isCurrent()) return;
              const text = await current.transcribe(encodeSpeechWav(event.frames, context.sampleRate), room.abort.signal);
              if (!isCurrent()) return;
              if (/[\p{L}\p{N}]/u.test(text) && !emptyTranscript.test(text)) await current.submit(pinId, text.slice(0, 2000));
              else if (recorded.wasPlaying) await current.resumeAfterNoise(pinId);
            } catch (cause) {
              if (!room.abort.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not use the room microphone.");
            } finally { busy = false; if (!room.abort.signal.aborted) setStatus("ready"); }
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
      setError("Could not start the room microphone. Use Talk or type your question.");
    }
  };

  return { error, observeAudio, start, status, stop };
};
