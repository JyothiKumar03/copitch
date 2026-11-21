"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TPresentationAction, TPresentationState } from "@/types/presentation";

export const useNarration = (
  attemptId: string | undefined,
  load: (attemptId: string, signal: AbortSignal) => Promise<Blob>,
  command: (action: TPresentationAction) => Promise<TPresentationState>,
  observeAudio: (element: HTMLAudioElement) => () => void,
) => {
  const playback = useRef<{ stop: () => void } | null>(null);
  const latest = useRef({ load, command, observeAudio });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { latest.current = { load, command, observeAudio }; }, [load, command, observeAudio]);

  const stop = useCallback(() => { playback.current?.stop(); playback.current = null; }, []);
  useEffect(() => {
    if (!attemptId) return;
    const abort = new AbortController();
    let objectUrl: string | undefined;
    let audio: HTMLAudioElement | undefined;
    let unobserve: (() => void) | undefined;
    let acknowledgement: Promise<TPresentationState> | undefined;
    const player = { stop: () => {
      abort.abort();
      if (audio) { audio.onplaying = audio.onended = audio.onerror = null; audio.pause(); audio.removeAttribute("src"); audio.load(); }
      unobserve?.();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    } };
    playback.current = player;

    const report = async (kind: "ended" | "failed") => {
      if (abort.signal.aborted) return;
      try {
        if (acknowledgement && kind === "ended") await acknowledgement;
        if (!abort.signal.aborted) await latest.current.command({ kind, attempt_id: attemptId });
      } catch (cause) {
        if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "Audio progress could not be saved.");
      }
    };
    const play = async () => {
      try {
        const blob = await latest.current.load(attemptId, abort.signal);
        if (abort.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        audio = new Audio(objectUrl);
        unobserve = latest.current.observeAudio(audio);
        audio.onplaying = () => {
          if (!acknowledgement && !abort.signal.aborted) {
            setError(null);
            acknowledgement = latest.current.command({ kind: "playing", attempt_id: attemptId });
            void acknowledgement.catch(() => {
              if (!abort.signal.aborted) { audio?.pause(); setError("Playback could not be confirmed. Press Pause, then Resume."); }
            });
          }
        };
        audio.onended = () => { void report("ended"); };
        audio.onerror = () => { setError("Could not play narration. Press Resume to try again."); void report("failed"); };
        await audio.play();
      } catch (cause) {
        if (!abort.signal.aborted) {
          setError(cause instanceof DOMException && cause.name === "NotAllowedError" ?
            "Your browser blocked audio. Press Resume to try again." : "Narration audio failed. Press Resume to try again.");
          await report("failed");
        }
      }
    };
    void play();
    return () => { player.stop(); if (playback.current === player) playback.current = null; };
  }, [attemptId]);

  return { error, stop };
};
