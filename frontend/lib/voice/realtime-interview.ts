import { LANGUAGE_OPTIONS, type TInterviewLanguage } from "../../../shared/languages";
import { createRealtimeTurns } from "./realtime-turns";
import { connectInterview } from "../interview";
import type { TGetSession } from "@/types/interview";

type TStreamCallbacks = {
  onStart: () => void;
  onEnd: () => void;
  onInterim: (text: string) => void;
  onFinal: (text: string, turnId: string) => void;
  onWarning: (message: string) => void;
  onFailure: (message: string) => void;
};

export const openRealtimeInterview = async (getSession: TGetSession, signal: AbortSignal, callbacks: TStreamCallbacks) => {
  if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
    throw new Error("Live voice is unavailable in this browser. You can type your message.");
  }
  const peer = new RTCPeerConnection();
  const channel = peer.createDataChannel("oai-events");
  let stream: MediaStream | undefined;
  let closed = false;
  const turns = createRealtimeTurns(callbacks);
  const staleTimer = window.setInterval(turns.expire, 5000);
  let language: TInterviewLanguage | undefined;
  let model: string | undefined;
  let configured: string | undefined;
  const updateLanguage = () => {
    if (!language || !model || configured === language || channel.readyState !== "open") return;
    channel.send(JSON.stringify({ type: "session.update", session: { type: "transcription", audio: { input: {
      transcription: { model, language, prompt: LANGUAGE_OPTIONS[language].transcription_prompt },
    } } } }));
    configured = language;
  };
  const setLanguage = (value: TInterviewLanguage) => { language = value; updateLanguage(); };
  const close = () => {
    if (closed) return;
    closed = true;
    window.clearInterval(staleTimer);
    signal.removeEventListener("abort", close);
    stream?.getTracks().forEach(track => track.stop());
    channel.close();
    peer.close();
  };
  const fail = () => {
    if (!closed) callbacks.onFailure("The voice connection ended. Reconnect voice or type your message.");
  };
  channel.onmessage = ({ data }) => {
    if (closed || typeof data !== "string" || data.length > 131072) return;
    let event;
    try { event = JSON.parse(data); } catch { return; }
    if (!event || typeof event !== "object") return;
    if (event.type === "session.created") {
      const transcription = event.session?.audio?.input?.transcription;
      if (typeof transcription?.model === "string") model = transcription.model;
      configured = transcription?.language;
      updateLanguage();
    }
    if (event.type === "input_audio_buffer.speech_started") callbacks.onStart();
    if (event.type === "input_audio_buffer.speech_stopped") callbacks.onEnd();
    if (event.type === "error") { fail(); return; }
    turns.handle(event);
  };
  signal.addEventListener("abort", close, { once: true });
  channel.onclose = fail;
  channel.onerror = fail;
  peer.onconnectionstatechange = () => { if (peer.connectionState === "failed") fail(); };
  try {
    signal.throwIfAborted();
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    if (signal.aborted) stream.getTracks().forEach(track => track.stop());
    signal.throwIfAborted();
    const track = stream.getAudioTracks()[0];
    track.addEventListener("ended", fail, { once: true });
    peer.addTrack(track, stream);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    if (peer.iceGatheringState !== "complete") {
      await new Promise<void>(resolve => {
        const finish = () => {
          clearTimeout(timeout);
          peer.removeEventListener("icegatheringstatechange", check);
          resolve();
        };
        const check = () => { if (peer.iceGatheringState === "complete") finish(); };
        const timeout = setTimeout(finish, 1500);
        peer.addEventListener("icegatheringstatechange", check);
        check();
      });
    }
    signal.throwIfAborted();
    const session = await getSession();
    signal.throwIfAborted();
    const sdp = await connectInterview(session, peer.localDescription!.sdp, signal);
    signal.throwIfAborted();
    await peer.setRemoteDescription({ type: "answer", sdp });
    if (channel.readyState !== "open") {
      await new Promise<void>((resolve, reject) => {
        const finish = () => {
          clearTimeout(timeout);
          channel.removeEventListener("open", finish);
          signal.removeEventListener("abort", finish);
          if (channel.readyState === "open") resolve();
          else reject(new Error("Live audio could not connect. Use a recorded message or type."));
        };
        const timeout = setTimeout(finish, 12000);
        channel.addEventListener("open", finish);
        signal.addEventListener("abort", finish, { once: true });
        if (signal.aborted) finish();
      });
    }
    return { close, setLanguage };
  } catch (cause) {
    close();
    throw cause;
  }
};
