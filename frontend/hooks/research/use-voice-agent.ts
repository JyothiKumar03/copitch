"use client";

import { useEffect, useRef, useState } from "react";
import { connectInterview, closeVoice } from "@/lib/interview";
import { createVoicePreview, readVoiceFragment } from "@/lib/voice-preview";
import type { TVoiceCaption } from "@/lib/voice-preview";
import { LIVE_BACKCHANNEL_MS, LIVE_EXCHANGE_IDLE_MS } from "../../../shared/voice-transcript";
import type { TGetSession, TVoicePhase } from "@/types/interview";
import type { TResearchSession } from "@/types/research";

type TVoiceOptions = { committed: ReadonlySet<string>; onClose: () => void };
type TLink = { peer: RTCPeerConnection; channel: RTCDataChannel; stream: MediaStream; audio: HTMLAudioElement;
  session: TResearchSession; lease?: string; preview?: ReturnType<typeof createVoicePreview>;
  quiet?: ReturnType<typeof setTimeout>; settle?: ReturnType<typeof setTimeout>; timer?: ReturnType<typeof setTimeout> };

// The Live model hears, speaks and handles interruptions itself; the server records the conversation and checks every
// action. The browser carries audio, shows live captions, and can only hang up.
export const useVoiceAgent = (getSession: TGetSession, options: TVoiceOptions) => {
  const latest = useRef({ getSession, options });
  useEffect(() => { latest.current = { getSession, options }; });
  const live = useRef<TLink | null>(null);
  const pending = useRef<AbortController | null>(null);
  const closing = useRef<Promise<void> | null>(null);
  const [captions, setCaptions] = useState<TVoiceCaption[]>([]);
  const [handsFree, setConnected] = useState(false);
  const [replying, setReplying] = useState(false);
  const [phase, setPhase] = useState<TVoicePhase>("idle");
  const [error, setError] = useState("");
  const [voiceEnabled, setVoiceEnabled] = useState(() => {
    try { return sessionStorage.getItem("copitch.voice.read-aloud") !== "off"; } catch { return true; }
  });
  const enabled = useRef(voiceEnabled);

  const close = (notice?: string) => {
    pending.current?.abort(); pending.current = null;
    const call = live.current;
    live.current = null;
    if (call) {
      clearTimeout(call.timer); clearTimeout(call.quiet); clearTimeout(call.settle);
      call.preview?.seal();
      if (call.preview) setCaptions(call.preview.captions());
      call.stream.getTracks().forEach(track => track.stop());
      call.audio.pause(); call.audio.srcObject = null;
      call.channel.close(); call.peer.close();
      if (call.lease) {
        const closeRequest = closeVoice(call.session, call.lease).catch(() => {}).finally(() => {
          if (closing.current === closeRequest) closing.current = null;
          latest.current.options.onClose();
        });
        closing.current = closeRequest;
      }
    }
    setConnected(false); setReplying(false); setPhase("idle");
    if (notice) setError(notice);
  };
  useEffect(() => {
    const leave = () => close();
    window.addEventListener("pagehide", leave);
    return () => { window.removeEventListener("pagehide", leave); close(); };
  }, []);

  const handle = (call: TLink, event: unknown) => {
    if (live.current !== call || !call.preview) return;
    const fragment = readVoiceFragment(event);
    if (!fragment) return;
    const activity = call.preview.accept(fragment, latest.current.options.committed);
    if (!activity) return;
    setCaptions(call.preview.captions());
    clearTimeout(call.settle);
    if (activity === "agent" || activity === "tail") {
      call.settle = setTimeout(() => {
        if (live.current !== call || !call.preview) return;
        call.preview.seal();
        setCaptions(call.preview.captions());
      }, LIVE_EXCHANGE_IDLE_MS);
    }
    if (activity === "tail") return;
    clearTimeout(call.quiet);
    if (activity === "host") {
      setPhase("recording"); setReplying(false);
      call.quiet = setTimeout(() => { if (live.current === call) setPhase("transcribing"); }, LIVE_BACKCHANNEL_MS);
      return;
    }
    setPhase("idle"); setReplying(true);
    call.quiet = setTimeout(() => { if (live.current === call) setReplying(false); }, LIVE_BACKCHANNEL_MS);
  };

  const setHandsFree = async (on: boolean) => {
    if (!on) { close(); return; }
    if (pending.current || live.current) return;
    const abort = new AbortController();
    pending.current = abort;
    setError(""); setPhase("requesting"); setConnected(true);
    let stream: MediaStream | undefined;
    try {
      await closing.current;
      if (abort.signal.aborted) return;
      setCaptions([]);
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
        if (live.current === call && ["failed", "closed", "disconnected"].includes(peer.connectionState)) close("Voice disconnected. Restart voice or continue by typing.");
      };
      channel.onclose = () => { if (live.current === call) close("Voice disconnected. Restart voice or continue by typing."); };
      channel.onopen = () => { if (live.current === call) { clearTimeout(call.timer); setPhase("idle"); } };
      channel.onmessage = ({ data }) => {
        if (typeof data !== "string" || data.length > 160000) return;
        try {
          const event: unknown = JSON.parse(data);
          if (event && typeof event === "object" && "type" in event && event.type === "session.closed") close();
          else handle(call, event);
        } catch { /* Ignore malformed events. */ }
      };
      await peer.setLocalDescription(await peer.createOffer());
      const answer = await connectInterview(session, peer.localDescription!.sdp, abort.signal);
      if (live.current !== call) { void closeVoice(session, answer.lease).catch(() => {}); return; }
      call.lease = answer.lease;
      call.preview = createVoicePreview(answer.lease);
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
  };
  return { captions, replying, handsFree, setHandsFree, phase, voiceEnabled, enableVoice, error };
};
