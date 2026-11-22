"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TPresentationAction, TPresentationState } from "@/types/presentation";

const NARRATION_RATE = 1.2;

export const useNarration = (
  attemptId: string | undefined,
  load: (attemptId: string, signal: AbortSignal) => Promise<Blob>,
  command: (action: TPresentationAction) => Promise<TPresentationState>,
  observeAudio: (element: HTMLAudioElement) => () => void,
) => {
  const playback = useRef<{ hold: () => () => void; duck: () => (advance?: boolean) => void; stop: () => void } | null>(null);
  const latest = useRef({ load, command, observeAudio });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { latest.current = { load, command, observeAudio }; }, [load, command, observeAudio]);

  const hold = useCallback(() => playback.current?.hold(), []);
  const duck = useCallback(() => playback.current?.duck(), []);
  useEffect(() => {
    if (!attemptId) return;
    const abort = new AbortController();
    let objectUrl: string | undefined;
    let audio: HTMLAudioElement | undefined;
    let unobserve: (() => void) | undefined;
    let acknowledgement: Promise<TPresentationState> | undefined;
    const holds = new Set<symbol>();
    const ducks = new Set<symbol>();
    let endedDuringSpeech = false;
    let normalVolume = 1;

    const report = async (kind: "ended" | "failed") => {
      if (abort.signal.aborted) return;
      try {
        if (acknowledgement && kind === "ended") await acknowledgement;
        if (!abort.signal.aborted) await latest.current.command({ kind, attempt_id: attemptId });
      } catch (cause) {
        if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "Audio progress could not be saved.");
      }
    };
    const fail = async (cause: unknown) => {
      if (abort.signal.aborted) return;
      setError(cause instanceof DOMException && cause.name === "NotAllowedError" ?
        "Your browser blocked audio. Press Resume to try again." : "Narration audio failed. Press Resume to try again.");
      await report("failed");
    };
    const play = async () => {
      if (!audio || holds.size || abort.signal.aborted) return;
      try { await audio.play(); }
      catch (cause) { if (!holds.size) await fail(cause); }
    };
    const player = {
      hold: () => {
        const id = Symbol();
        holds.add(id);
        audio?.pause();
        return () => { if (holds.delete(id) && !holds.size) void play(); };
      },
      duck: () => {
        const id = Symbol();
        if (!ducks.size) normalVolume = audio?.volume ?? 1;
        ducks.add(id);
        if (audio) audio.volume = 0.2;
        return (advance = true) => {
          if (!ducks.delete(id) || ducks.size || abort.signal.aborted) return;
          if (audio) audio.volume = normalVolume;
          if (endedDuringSpeech && advance) void report("ended");
          endedDuringSpeech = false;
        };
      },
      stop: () => {
        abort.abort();
        if (audio) { audio.onplaying = audio.onended = audio.onerror = null; audio.pause(); audio.removeAttribute("src"); audio.load(); }
        unobserve?.();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      },
    };
    playback.current = player;
    const load = async () => {
      try {
        const blob = await latest.current.load(attemptId, abort.signal);
        if (abort.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        audio = new Audio(objectUrl);
        // TTS reads at about 150 words per minute and ignores pace instructions; 1.2x keeps the pitch and sounds like a live presenter.
        audio.playbackRate = NARRATION_RATE;
        audio.preservesPitch = true;
        if (ducks.size) audio.volume = 0.2;
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
        audio.onended = () => {
          if (ducks.size) endedDuringSpeech = true;
          else void report("ended");
        };
        audio.onerror = () => { setError("Could not play narration. Press Resume to try again."); void report("failed"); };
        await play();
      } catch (cause) { await fail(cause); }
    };
    void load();
    return () => { player.stop(); if (playback.current === player) playback.current = null; };
  }, [attemptId]);

  return { error, hold, duck };
};
