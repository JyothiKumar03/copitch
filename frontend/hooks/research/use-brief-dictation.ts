"use client";

import { useEffect, useRef, useState } from "react";
import { openRealtimeInterview } from "@/lib/voice/realtime-interview";
import type { THandsFreeOptions } from "@/types/vad";
import { speakQuestion, transcribeAudio } from "@/lib/interview";
import type { TGetSession, TRecordingPhase } from "@/types/interview";
import { DEFAULT_LANGUAGE } from "../../../shared/languages";

export const useBriefDictation = (getSession: TGetSession, options?: THandsFreeOptions) => {
  const settings = useRef({getSession, options});
  useEffect(() => { settings.current = { getSession, options }; }, [getSession, options]);
  const listening = useRef<AbortController | null>(null);
  const graph = useRef<Awaited<ReturnType<typeof openRealtimeInterview>> | null>(null);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [turns, setTurns] = useState<{ text: string; turnId: string }[]>([]);
  const queued = useRef(0);
  const [handsFree, setListening] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const capture = useRef<AbortController | null>(null);
  const playback = useRef<AbortController | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const objectUrl = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hostSpeaking = useRef(false);
  const [speaking, setSpeaking] = useState(false);
  const [phase, setPhase] = useState<TRecordingPhase>("idle");
  const [error, setError] = useState("");
  const [voiceEnabled, setVoiceEnabled] = useState(() => {
    try { return sessionStorage.getItem("copitch.voice.read-aloud") !== "off"; } catch { return true; }
  });
  const enabled = useRef(voiceEnabled);

  useEffect(() => {
    if (!turns.length || options?.suspended || !listening.current) return;
    queued.current--;
    settings.current.options?.onFinal(turns[0].text, turns[0].turnId);
    setTurns(current => current.slice(1));
  }, [turns, options?.suspended]);

  useEffect(() => {
    graph.current?.setLanguage(options?.language ?? DEFAULT_LANGUAGE);
  }, [options?.language]);

  const stopPlayback = () => {
    setSpeaking(false);
    playback.current?.abort();
    player.current?.pause();
    player.current = null;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = "";
  };

  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      listening.current?.abort();
      graph.current?.close();
      capture.current?.abort();
      clearTimeout(timer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      recorder.current?.stream.getTracks().forEach(track => track.stop());
      stopPlayback();
    };
  }, []);

  const endListening = () => {
    if (listening.current || graph.current) stopPlayback();
    listening.current?.abort();
    listening.current = null;
    graph.current?.close();
    graph.current = null;
    queued.current = 0;
    setTurns([]);
    setInterimTranscript("");
    hostSpeaking.current = false;
    setListening(false);
  };

  const cancelCapture = () => {
    endListening();
    capture.current?.abort();
    capture.current = null;
    clearTimeout(timer.current);
    const active = recorder.current;
    recorder.current = null;
    if (active?.state === "recording") active.stop();
    active?.stream.getTracks().forEach(track => track.stop());
    setPhase("idle");
  };

  const dictate = async (append: (text: string) => void) => {
    if (recorder.current?.state === "recording") { recorder.current.stop(); return; }
    if (capture.current && !capture.current.signal.aborted) return;
    endListening();
    stopPlayback();
    setError("");
    const controller = new AbortController();
    capture.current = controller;
    let stream: MediaStream | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("Audio capture is unavailable. You can type your brief.");
      setPhase("requesting");
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (controller.signal.aborted) { stream.getTracks().forEach(track => track.stop()); return; }
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(type => MediaRecorder.isTypeSupported(type));
      const active = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.current = active;
      const chunks: Blob[] = [];
      active.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      active.onerror = () => {
        controller.abort(); clearTimeout(timer.current);
        active.stream.getTracks().forEach(track => track.stop());
        setError("Recording stopped unexpectedly. Try again or type your brief."); setPhase("idle");
      };
      active.onstop = async () => {
        clearTimeout(timer.current);
        active.stream.getTracks().forEach(track => track.stop());
        if (recorder.current === active) recorder.current = null;
        if (controller.signal.aborted) return;
        setPhase("transcribing");
        try {
          const blob = new Blob(chunks, { type: active.mimeType });
          if (!blob.size) throw new Error("No audio was captured. Try again or type your brief.");
          const transcript = await transcribeAudio(await getSession(), blob, controller.signal);
          if (!controller.signal.aborted) append(transcript);
        } catch (cause) {
          if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Transcription failed. You can type your brief.");
        } finally {
          if (!controller.signal.aborted) setPhase("idle");
          if (capture.current === controller) capture.current = null;
        }
      };
      active.start();
      setPhase("recording");
      timer.current = setTimeout(() => { if (active.state === "recording") active.stop(); }, 60000);
    } catch (cause) {
      stream?.getTracks().forEach(track => track.stop());
      if (!controller.signal.aborted) {
        setError(cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "Microphone access is blocked. Allow the microphone in your browser’s site settings, or type your message."
          : cause instanceof Error ? cause.message : "Microphone unavailable. You can type your message."); setPhase("idle");
      }
      if (capture.current === controller) capture.current = null;
    }
  };

  const setHandsFree = async (value: boolean) => {
    if (!value) { cancelCapture(); return; }
    if (listening.current) return;
    cancelCapture(); setError("");
    const controller = new AbortController();
    listening.current = controller;
    setListening(true); setPhase("requesting");
    const fail = (message: string) => {
      if (listening.current !== controller || controller.signal.aborted) return;
      cancelCapture();
      setError(message);
    };
    try {
      const active = await openRealtimeInterview(settings.current.getSession, controller.signal, {
        onStart: () => { hostSpeaking.current = true; stopPlayback(); setPhase("recording"); },
        onEnd: () => { hostSpeaking.current = false; setPhase("transcribing"); },
        onInterim: text => { if (!controller.signal.aborted) setInterimTranscript(text); },
        onWarning: message => { if (!controller.signal.aborted) { setError(message); setPhase("idle"); } },
        onFinal: (text, turnId) => {
          if (!controller.signal.aborted) {
            setPhase("idle");
            if (queued.current >= 24) {
              setError("The voice queue is full. Please finish the pending messages and repeat this turn.");
            } else if (text) {
              queued.current++;
              setTurns(current => [...current, { text, turnId }]);
            }
          }
        },
        onFailure: fail,
      });
      if (controller.signal.aborted) { active.close(); return; }
      graph.current = active;
      active.setLanguage(settings.current.options?.language ?? DEFAULT_LANGUAGE);
      setPhase("idle");
    } catch (cause) {
      if (!controller.signal.aborted) fail(cause instanceof DOMException && cause.name === "NotAllowedError"
        ? "Microphone access was denied. Allow it in site settings or type your message."
        : cause instanceof Error ? cause.message : "Live audio could not start. Record a message or type.");
    }
  };

  useEffect(() => {
    const release = () => {
      if (!listening.current) return;
      hostSpeaking.current = false;
      listening.current.abort();
      listening.current = null;
      graph.current?.close();
      graph.current = null;
      queued.current = 0;
      setTurns([]);
      setInterimTranscript("");
      stopPlayback();
      setListening(false); setPhase("idle");
    };
    window.addEventListener("pagehide", release);
    return () => window.removeEventListener("pagehide", release);
  }, []);

  const readQuestion = async (question: string, progressTurnId?: string) => {
    if (!mounted.current || !enabled.current || hostSpeaking.current) return;
    stopPlayback(); setError("");
    const controller = new AbortController();
    playback.current = controller;
    try {
      const blob = await speakQuestion(await getSession(), question, controller.signal, progressTurnId);
      if (controller.signal.aborted) return;
      objectUrl.current = URL.createObjectURL(blob);
      const audio = new Audio(objectUrl.current);
      player.current = audio;
      audio.onplaying = () => { if (player.current === audio) setSpeaking(true); };
      audio.onpause = () => { if (player.current === audio) setSpeaking(false); };
      audio.onended = () => { if (player.current === audio) stopPlayback(); };
      await audio.play();
    } catch {
      if (!controller.signal.aborted) { stopPlayback(); setError("Question audio could not play. Read the question or replay it."); }
    }
  };
  const enableVoice = (value: boolean) => {
    try { sessionStorage.setItem("copitch.voice.read-aloud", value ? "on" : "off"); } catch { /* Use the in-memory preference. */ }
    enabled.current = value;
    setVoiceEnabled(value);
    if (!value) stopPlayback();
  };
  return { speaking, handsFree, setHandsFree, dictate, cancelCapture, readQuestion, stopPlayback, phase, voiceEnabled, enableVoice, error, interimTranscript };
};
