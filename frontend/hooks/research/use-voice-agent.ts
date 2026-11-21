"use client";

import { useEffect, useRef, useState } from "react";
import { connectInterview, closeVoice } from "@/lib/interview";
import { isLateHostCaption } from "@/lib/voice-preview";
import type { TGetSession, TVoicePhase } from "@/types/interview";
import type { TResearchSession } from "@/types/research";

type TVoiceCaption = { speaker: "host" | "agent"; text: string; id: string; final: boolean };
type TVoiceOptions = { onVoiceTurn?: (caption: TVoiceCaption) => void };
type TLink = { peer: RTCPeerConnection; channel: RTCDataChannel; stream: MediaStream; audio: HTMLAudioElement;
  session: TResearchSession; lease?: string; caption?: TVoiceCaption; quiet?: ReturnType<typeof setTimeout>; timer?: ReturnType<typeof setTimeout>;
  hostUntil?: number; agentUntil?: number };
type TLiveEvent = { type?: string; delta?: string; start_ms?: number; end_ms?: number };

// The Live model hears, speaks and handles interruptions itself; the server records the conversation and checks every
// action. The browser carries audio, shows live captions, and can only hang up.
export const useVoiceAgent = (getSession: TGetSession, options: TVoiceOptions) => {
  const latest = useRef({ getSession, options });
  useEffect(() => { latest.current = { getSession, options }; });
  const live = useRef<TLink | null>(null);
  const pending = useRef<AbortController | null>(null);
  const [handsFree, setConnected] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [phase, setPhase] = useState<TVoicePhase>("idle");
  const [error, setError] = useState("");
  const [voiceEnabled, setVoiceEnabled] = useState(() => {
    try { return sessionStorage.getItem("copitch.voice.read-aloud") !== "off"; } catch { return true; }
  });
  const enabled = useRef(voiceEnabled);

  const close = () => {
    pending.current?.abort(); pending.current = null;
    const call = live.current;
    live.current = null;
    if (call) {
      clearTimeout(call.timer); clearTimeout(call.quiet);
      call.stream.getTracks().forEach(track => track.stop());
      call.audio.pause(); call.audio.srcObject = null;
      call.channel.close(); call.peer.close();
      if (call.lease) void closeVoice(call.session, call.lease).catch(() => {});
    }
    setConnected(false); setSpeaking(false); setPhase("idle");
  };
  useEffect(() => {
    window.addEventListener("pagehide", close);
    return () => { window.removeEventListener("pagehide", close); close(); };
  }, []);

  const show = (call: TLink, caption: TVoiceCaption) => {
    call.caption = caption;
    latest.current.options.onVoiceTurn?.(caption);
  };
  const handle = (call: TLink, event: TLiveEvent) => {
    if (live.current !== call || !event.delta) return;
    const speaker = event.type === "session.input_transcript.delta" ? "host" : event.type === "session.output_transcript.delta" ? "agent" : null;
    if (!speaker) return;
    const current = call.caption;
    const end = event.end_ms ?? event.start_ms;
    if (speaker === "host") {
      if (current?.speaker === "agent" && isLateHostCaption(event.start_ms, call.hostUntil, call.agentUntil)) {
        // The saved transcript still receives this overlapping input. Leave the reply caption and playout status in place.
        if (end !== undefined) call.hostUntil = Math.max(call.hostUntil ?? end, end);
        return;
      }
      call.hostUntil = end === undefined || current?.speaker !== "host" ? end : Math.max(call.hostUntil ?? end, end);
    } else {
      call.agentUntil = end === undefined || current?.speaker !== "agent" ? end : Math.max(call.agentUntil ?? end, end);
    }
    if (current && current.speaker !== speaker && !current.final) show(call, { ...current, final: true });
    // The host's caption id matches the id the server saves the exchange under, so the caption gives way to the saved turn.
    const continuing = current?.speaker === speaker && !current.final;
    show(call, continuing ? { ...current, text: current.text + event.delta } :
      { speaker, text: event.delta, id: (speaker === "host" ? "live:" : "agent:") + (event.start_ms ?? Date.now()), final: false });
    clearTimeout(call.quiet);
    if (speaker === "host") { setPhase("recording"); setSpeaking(false); return; }
    setPhase("idle"); setSpeaking(enabled.current);
    call.quiet = setTimeout(() => {
      setSpeaking(false);
      if (call.caption?.speaker === "agent") show(call, { ...call.caption, final: true });
    }, 1500);
  };

  const setHandsFree = async (on: boolean) => {
    if (!on) { close(); return; }
    if (pending.current || live.current) return;
    const abort = new AbortController();
    pending.current = abort;
    setError(""); setPhase("requesting"); setConnected(true);
    let stream: MediaStream | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") throw new Error("Live voice requires a secure browser with microphone access.");
      const session = await latest.current.getSession();
      if (abort.signal.aborted) return;
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      if (abort.signal.aborted) { stream.getTracks().forEach(track => track.stop()); return; }
      const peer = new RTCPeerConnection();
      const channel = peer.createDataChannel("oai-events");
      const audio = new Audio();
      audio.autoplay = true; audio.muted = !enabled.current;
      const call: TLink = { peer, channel, audio, session, stream };
      live.current = call;
      peer.addTrack(stream.getAudioTracks()[0], stream);
      peer.ontrack = event => {
        audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        void audio.play().catch(() => { if (live.current === call) setError("Tap the page and reconnect voice to hear the interviewer."); });
      };
      peer.onconnectionstatechange = () => {
        if (live.current === call && ["failed", "closed", "disconnected"].includes(peer.connectionState)) close();
      };
      channel.onclose = () => { if (live.current === call) close(); };
      channel.onopen = () => { if (live.current === call) { clearTimeout(call.timer); setPhase("idle"); } };
      channel.onmessage = ({ data }) => {
        if (typeof data !== "string" || data.length > 160000) return;
        try {
          const event = JSON.parse(data) as TLiveEvent;
          if (event.type === "session.closed") close(); else handle(call, event);
        } catch { /* Ignore malformed events. */ }
      };
      await peer.setLocalDescription(await peer.createOffer());
      const answer = await connectInterview(session, peer.localDescription!.sdp, abort.signal);
      if (live.current !== call) { void closeVoice(session, answer.lease).catch(() => {}); return; }
      call.lease = answer.lease;
      call.timer = setTimeout(() => { if (live.current === call) { close(); setError("Voice could not connect. Try again or type your message."); } }, 15000);
      await peer.setRemoteDescription({ type: "answer", sdp: answer.sdp });
    } catch (cause) {
      stream?.getTracks().forEach(track => track.stop());
      if (!abort.signal.aborted) {
        close(); setError(cause instanceof DOMException && cause.name === "NotAllowedError" ? "Microphone access was denied. Allow it in site settings or type your message."
          : cause instanceof Error ? cause.message : "Voice could not connect. You can type your message.");
      }
    } finally { if (pending.current === abort) pending.current = null; }
  };
  const enableVoice = (value: boolean) => {
    enabled.current = value; setVoiceEnabled(value);
    try { sessionStorage.setItem("copitch.voice.read-aloud", value ? "on" : "off"); } catch { /* Optional preference. */ }
    if (live.current) live.current.audio.muted = !value;
    if (!value) setSpeaking(false);
  };
  return { speaking, handsFree, setHandsFree, phase, voiceEnabled, enableVoice, error };
};
