export type TRealtimeSpeechEvent =
  | { kind: "started" | "stopped" | "failed"; itemId: string }
  | { kind: "delta" | "completed"; itemId: string; text: string };

type TRealtimeSpeech = { listen: (enabled: boolean) => void; close: () => void };

const parseSpeechEvent = (event: Record<string, unknown>): TRealtimeSpeechEvent | undefined => {
  const { type, item_id: itemId } = event;
  if (typeof itemId !== "string" || !itemId || itemId.length > 192) return;
  if (type === "input_audio_buffer.speech_started") return { kind: "started", itemId };
  if (type === "input_audio_buffer.speech_stopped") return { kind: "stopped", itemId };
  if (type === "conversation.item.input_audio_transcription.failed") return { kind: "failed", itemId };
  if (type === "conversation.item.input_audio_transcription.delta" && typeof event.delta === "string") {
    return { kind: "delta", itemId, text: event.delta };
  }
  if (type === "conversation.item.input_audio_transcription.completed" && typeof event.transcript === "string") {
    return { kind: "completed", itemId, text: event.transcript };
  }
};

export const openRealtimeSpeech = async (
  microphone: MediaStreamTrack,
  signal: AbortSignal,
  getAnswer: (offer: string, signal: AbortSignal) => Promise<string>,
  onSpeech: (event: TRealtimeSpeechEvent) => void,
  onFallback: () => void,
): Promise<TRealtimeSpeech> => {
  signal.throwIfAborted();
  const peer = new RTCPeerConnection();
  const track = microphone.clone();
  track.enabled = false;
  const opening = Promise.withResolvers<void>();
  void opening.promise.catch(() => {});
  const startup = AbortSignal.any([signal, AbortSignal.timeout(6000)]);
  let phase: "opening" | "ready" | "closed" = "opening";
  let channel: RTCDataChannel | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  const close = () => {
    if (phase === "closed") return;
    phase = "closed";
    clearTimeout(reconnectTimer);
    startup.removeEventListener("abort", close);
    signal.removeEventListener("abort", close);
    opening.reject(new Error("Realtime microphone connection closed"));
    channel?.close();
    peer.close();
    track.stop();
  };
  const fail = () => {
    const usingRealtime = phase === "ready";
    close();
    if (usingRealtime) onFallback();
  };
  signal.addEventListener("abort", close, { once: true });
  startup.addEventListener("abort", close, { once: true });
  try {
    peer.addTransceiver(track, { direction: "sendonly" });
    channel = peer.createDataChannel("oai-events");
    channel.onopen = () => opening.resolve();
    channel.onclose = fail;
    channel.onerror = fail;
    channel.onmessage = ({ data }) => {
      if (phase !== "ready" || typeof data !== "string" || data.length > 24_000) return;
      let event: Record<string, unknown>;
      try { event = JSON.parse(data); } catch { return; }
      if (!event || typeof event !== "object") return;
      if (event.type === "error") { fail(); return; }
      const speech = parseSpeechEvent(event);
      if (speech) onSpeech(speech);
    };
    const connectionChanged = () => {
      clearTimeout(reconnectTimer);
      if (peer.connectionState === "failed" || peer.iceConnectionState === "failed" || peer.connectionState === "closed") fail();
      else if (peer.connectionState === "disconnected" || peer.iceConnectionState === "disconnected") reconnectTimer = setTimeout(fail, 1500);
    };
    peer.onconnectionstatechange = connectionChanged;
    peer.oniceconnectionstatechange = connectionChanged;
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    startup.throwIfAborted();
    if (!offer.sdp) throw new Error("Realtime microphone offer unavailable");
    await peer.setRemoteDescription({ type: "answer", sdp: await getAnswer(offer.sdp, startup) });
    await opening.promise;
    startup.throwIfAborted();
    if (channel.readyState !== "open") throw new Error("Realtime microphone did not open");
    phase = "ready";
    startup.removeEventListener("abort", close);
    return { listen: enabled => { if (phase === "ready") track.enabled = enabled; }, close };
  } catch (error) {
    close();
    throw error;
  }
};
