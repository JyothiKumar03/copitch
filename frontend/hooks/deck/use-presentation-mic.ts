"use client";

import { useEffect, useRef, useState } from "react";

type TRecording = { abort: AbortController; media?: MediaStream; recorder?: MediaRecorder; timer?: ReturnType<typeof setTimeout> };

const dispose = (recording: TRecording) => {
  recording.abort.abort();
  clearTimeout(recording.timer);
  if (recording.recorder?.state === "recording") recording.recorder.stop();
  recording.media?.getTracks().forEach(track => track.stop());
};

export const usePresentationMic = (
  pin: () => Promise<string | null>,
  transcribe: (clip: Blob, signal: AbortSignal) => Promise<string>,
  submit: (pinId: string, message: string) => Promise<unknown>,
) => {
  const active = useRef<TRecording | null>(null);
  const [status, setStatus] = useState<"idle" | "opening" | "recording" | "transcribing">("idle");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => { if (active.current) dispose(active.current); active.current = null; }, []);

  const start = async () => {
    if (active.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("This browser cannot record audio. You can type your question."); return;
    }
    const recording: TRecording = { abort: new AbortController() };
    active.current = recording;
    setError(null);
    setStatus("opening");
    const fail = (message: string) => {
      if (active.current !== recording) return;
      setError(message);
      dispose(recording);
      active.current = null;
      setStatus("idle");
    };
    try {
      const pinId = pin();
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (recording.abort.signal.aborted) { media.getTracks().forEach(track => track.stop()); return; }
      recording.media = media;
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(value => MediaRecorder.isTypeSupported(value));
      const recorder = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      recording.recorder = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => fail("Recording stopped unexpectedly. You can try again or type.");
      recorder.onstop = async () => {
        clearTimeout(recording.timer);
        media.getTracks().forEach(track => track.stop());
        if (recording.abort.signal.aborted) return;
        setStatus("transcribing");
        try {
          const target = await pinId;
          if (!target) throw new Error("Could not pin the current slide. Try asking again.");
          if (!chunks.length) throw new Error("No audio was captured. Try recording again.");
          const text = await transcribe(new Blob(chunks, { type: recorder.mimeType }), recording.abort.signal);
          if (!text) throw new Error("No words were captured. Try again or type your message.");
          if (!recording.abort.signal.aborted) await submit(target, text.slice(0, 2000));
        } catch (cause) {
          if (!recording.abort.signal.aborted) fail(cause instanceof Error ? cause.message : "The recording did not finish.");
        } finally {
          if (active.current === recording) { active.current = null; setStatus("idle"); }
        }
      };
      recorder.start();
      setStatus("recording");
      recording.timer = setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, 30000);
    } catch { fail("Microphone unavailable. You can type your question."); }
  };
  const stop = () => { if (active.current?.recorder?.state === "recording") active.current.recorder.stop(); };
  return { error, start, status, stop };
};
