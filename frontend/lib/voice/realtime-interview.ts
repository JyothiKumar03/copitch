import { connectInterview } from "../interview";
import type { TGetSession } from "@/types/interview";

type TStreamCallbacks = {
  onStart: () => void;
  onEnd: () => void;
  onFinal: (text: string) => void;
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
  const close = () => {
    if (closed) return;
    closed = true;
    signal.removeEventListener("abort", close);
    stream?.getTracks().forEach(track => track.stop());
    channel.close();
    peer.close();
  };
  const fail = () => {
    if (!closed) callbacks.onFailure("The voice connection ended. Reconnect voice or type your message.");
  };
  const committed: string[] = [];
  const seen = new Set<string>();
  const transcripts = new Map<string, string>();
  channel.onmessage = ({ data }) => {
    if (closed || typeof data !== "string") return;
    let event;
    try { event = JSON.parse(data); } catch { return; }
    if (!event || typeof event !== "object") return;
    if (event.type === "input_audio_buffer.speech_started") callbacks.onStart();
    if (event.type === "input_audio_buffer.speech_stopped") callbacks.onEnd();
    if (event.type === "error" || event.type === "conversation.item.input_audio_transcription.failed") { fail(); return; }
    if (typeof event.item_id !== "string") return;
    if (event.type === "input_audio_buffer.committed" && !seen.has(event.item_id)) {
      seen.add(event.item_id);
      committed.push(event.item_id);
    }
    if (event.type === "conversation.item.input_audio_transcription.completed" && typeof event.transcript === "string") {
      if (seen.has(event.item_id) && !committed.includes(event.item_id)) return;
      transcripts.set(event.item_id, event.transcript.trim());
    }
    while (committed.length && transcripts.has(committed[0])) {
      const id = committed.shift()!;
      const text = transcripts.get(id)!;
      transcripts.delete(id);
      callbacks.onFinal(text);
    }
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
    return { close };
  } catch (cause) {
    close();
    throw cause;
  }
};
