const waitForMedia = (target: EventTarget, event: string, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const clear = () => {
      target.removeEventListener(event, finish);
      target.removeEventListener("error", failed);
      signal.removeEventListener("abort", failed);
    };
    const finish = () => { clear(); resolve(); };
    const failed = () => { clear(); reject(signal.reason ?? new Error("Audio playback failed")); };
    target.addEventListener(event, finish, { once: true });
    target.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", failed, { once: true });
  });

export const playReply = async (
  response: Response, audio: HTMLAudioElement, signal: AbortSignal, attach: (url: string) => void,
) => {
  const type = "audio/mpeg";
  if (!response.body || !globalThis.MediaSource?.isTypeSupported(type)) {
    const blob = await response.blob();
    signal.throwIfAborted();
    attach(URL.createObjectURL(blob));
    await audio.play();
    return;
  }
  const media = new MediaSource();
  const reader = response.body.getReader();
  const pump = async () => {
    const open = waitForMedia(media, "sourceopen", signal);
    attach(URL.createObjectURL(media));
    await open;
    const buffer = media.addSourceBuffer(type);
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      buffer.appendBuffer(new Uint8Array(value));
      await waitForMedia(buffer, "updateend", signal);
    }
    if (media.readyState === "open") media.endOfStream();
  };
  try {
    await Promise.all([pump(), audio.play()]);
  } finally {
    await reader.cancel().catch(() => {});
  }
};
