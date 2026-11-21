import { chromium } from "playwright";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const build = await Bun.build({
  entrypoints: [resolve(root, "frontend/lib/voice/hands-free-capture.ts")],
  target: "browser",
});
if (!build.success) throw new Error(build.logs.join("\n"));
const js = await build.outputs[0].text();
const server = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  fetch: request => {
    const path = new URL(request.url).pathname;
    if (path === "/capture.js") return new Response(js, { headers: { "Content-Type": "text/javascript" } });
    if (path === "/voice/interview-capture.js") return new Response(Bun.file(resolve(root, "frontend/public/voice/interview-capture.js")));
    return new Response("<!doctype html><title>Interview audio fixture</title>", { headers: { "Content-Type": "text/html" } });
  },
});
try {
  const browser = await chromium.launch({ channel: process.env.DECK_BROWSER_CHANNEL || undefined, args: ["--autoplay-policy=no-user-gesture-required"] });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(server.url.href);
    const result = await page.evaluate(async () => {
      const path = "/capture.js";
      const { openHandsFree } = await import(path);
      const source = new AudioContext();
      await source.resume();
      const oscillator = source.createOscillator(), volume = source.createGain(), destination = source.createMediaStreamDestination();
      volume.gain.value = 0;
      oscillator.frequency.value = 184;
      oscillator.connect(volume).connect(destination);
      oscillator.start();
      const track = destination.stream.getAudioTracks()[0];
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => destination.stream });
      const ctrl = new AbortController();
      let onsets = 0;
      let complete!: (blob: Blob) => void;
      let fail!: (error: Error) => void;
      const finished = new Promise<Blob>((resolve, reject) => { complete = resolve; fail = reject; });
      const timeout = setTimeout(() => fail(new Error("Expected one final audio turn")), 6000);
      try {
        const mic = await openHandsFree(ctrl.signal, {
          blocked: () => false, playing: () => false, onStart: () => { onsets++; },
          onEnd: complete, onFailure: (message: string) => fail(new Error(message)),
        });
        const now = source.currentTime;
        volume.gain.setValueAtTime(0.15, now + 0.2);
        volume.gain.setValueAtTime(0, now + 0.65);
        const blob = await finished;
        ctrl.abort();
        mic.close();
        return { onsets, type: blob.type, size: blob.size, mic: track.readyState };
      } finally {
        clearTimeout(timeout); ctrl.abort(); oscillator.stop(); await source.close();
      }
    });
    if (result.onsets !== 1 || result.type !== "audio/wav" || result.size < 10000 || result.mic !== "ended") {
      throw new Error("Unexpected capture result: " + JSON.stringify(result));
    }
    console.log(JSON.stringify(result));
  } finally { await browser.close(); }
} finally { server.stop(true); }
