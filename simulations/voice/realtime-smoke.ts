/**
 * Rehearse the real browser WebRTC interview with synthetic speech against a private loopback stack.
 * COPITCH_SMOKE_URL=http://localhost:3390 COPITCH_SMOKE_API_ORIGIN=http://localhost:3391 \
 * COPITCH_SMOKE_WAV=/path/to/english.wav bun simulations/voice/realtime-smoke.ts
 * Set both COPITCH_SMOKE_SWITCH_TELUGU_WAV and COPITCH_SMOKE_SWITCH_ENGLISH_WAV to check an in-call switch.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

type TVoiceProbe = {
  open: boolean;
  plays: number;
  stream?: MediaStream;
  peer?: RTCPeerConnection;
  feed: (clip: string) => Promise<void>;
};
type THistoryTurn = { role: string; text: string; turn_id: string };
declare global { interface Window { copitchVoiceProbe: TVoiceProbe } }

const web = new URL(process.env.COPITCH_SMOKE_URL ?? "http://localhost:3390");
const api = new URL(process.env.COPITCH_SMOKE_API_ORIGIN ?? web.origin);
if (![web, api].every(url => ["localhost", "127.0.0.1"].includes(url.hostname))) throw Error("Use an isolated loopback stack.");
const primary = process.env.COPITCH_SMOKE_WAV;
const telugu = process.env.COPITCH_SMOKE_SWITCH_TELUGU_WAV;
const english = process.env.COPITCH_SMOKE_SWITCH_ENGLISH_WAV;
if (!primary) throw Error("Supply a synthetic English recording with COPITCH_SMOKE_WAV.");
if (!!telugu !== !!english) throw Error("Supply both recordings for the language switch.");
const clips = telugu && english ? [[primary, "en"], [telugu, "te"], [english, "en"]] as const : [[primary, "en"]] as const;
const matchesLanguage = (text: string, language: "en" | "te") => language === "te"
  ? /\p{Script=Telugu}/u.test(text)
  : /[A-Za-z]/u.test(text) && !/\p{Script=Telugu}|\p{Script=Tamil}|\p{Script=Devanagari}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(text);

const browser = await chromium.launch({ channel: "chrome", args: ["--autoplay-policy=no-user-gesture-required"] });
try {
  const context = await browser.newContext({ permissions: ["microphone"] });
  const page = await context.newPage();
  await page.addInitScript(() => {
    let audio: AudioContext;
    let destination: MediaStreamAudioDestinationNode;
    const probe: TVoiceProbe = window.copitchVoiceProbe = {
      open: false, plays: 0,
      feed: async clip => {
        const bytes = Uint8Array.from(atob(clip), character => character.charCodeAt(0));
        const sample = audio.createBufferSource();
        sample.buffer = await audio.decodeAudioData(bytes.buffer);
        sample.connect(destination);
        sample.start();
      },
    };
    navigator.mediaDevices.getUserMedia = async () => {
      audio = new AudioContext();
      await audio.resume();
      destination = audio.createMediaStreamDestination();
      const silence = audio.createConstantSource();
      silence.offset.value = 0;
      silence.connect(destination);
      silence.start();
      probe.stream = destination.stream;
      return destination.stream;
    };
    const NativeAudio = window.Audio;
    window.Audio = new Proxy(NativeAudio, { construct: (target, args) => {
      const player = Reflect.construct(target, args) as HTMLAudioElement;
      player.addEventListener("playing", () => probe.plays++);
      return player;
    } });
    const Peer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Peer {
      createDataChannel(label: string, options?: RTCDataChannelInit) {
        probe.peer = this;
        const channel = super.createDataChannel(label, options);
        channel.addEventListener("open", () => { probe.open = true; });
        return channel;
      }
    };
  });
  await page.goto(new URL("/research", web).href);
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Email").fill("voice-" + crypto.randomUUID() + "@example.test");
  await page.getByLabel("Password").fill(crypto.randomUUID());
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByLabel("Project name").fill("Synthetic microphone check");
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByRole("button", { name: "Start voice conversation" }).click();
  await page.waitForFunction(() => window.copitchVoiceProbe.open, undefined, { timeout: 30_000 });
  const project = new URL(page.url()).searchParams.get("project");
  assert.ok(project, "Expected an authenticated project");
  const endpoint = new URL("/api/sessions/" + encodeURIComponent(project) + "/interview/workspace", api);
  const read = async () => {
    const response = await context.request.get(endpoint.href);
    assert.ok(response.ok(), "Workspace status " + response.status());
    return ((await response.json()).history ?? []) as THistoryTurn[];
  };
  for (const [index, [file, language]] of clips.entries()) {
    await page.evaluate(clip => window.copitchVoiceProbe.feed(clip), (await readFile(file)).toString("base64"));
    let exchange: { host: string; reply: string } | undefined;
    const deadline = Date.now() + 50_000;
    while (Date.now() < deadline) {
      const history = await read();
      const host = history.filter(turn => turn.role === "host")[index];
      const reply = host && history.find(turn => turn.role === "assistant" && turn.turn_id === host.turn_id);
      if (host && reply) { exchange = { host: host.text, reply: reply.text }; break; }
      await Bun.sleep(500);
    }
    assert.ok(exchange, "Expected a paired, saved voice turn");
    assert.ok(matchesLanguage(exchange.host, language), "Saved transcript did not match " + language);
    assert.ok(matchesLanguage(exchange.reply, language), "Spoken reply did not match " + language);
    console.log(JSON.stringify({ turn: index + 1, language, ...exchange }));
  }
  const playback = await page.evaluate(async () => {
    const probe = window.copitchVoiceProbe;
    const stats = await probe.peer?.getStats();
    let bytes = 0;
    stats?.forEach(entry => { if (entry.type === "inbound-rtp" && entry.kind === "audio") bytes += entry.bytesReceived ?? 0; });
    return { plays: probe.plays, bytes };
  });
  assert.ok(playback.plays && playback.bytes, "Remote WebRTC audio never played");
  await page.getByRole("button", { name: "End voice" }).click();
  await page.waitForFunction(() => window.copitchVoiceProbe.stream?.getTracks().every(track => track.readyState === "ended"));
  assert.equal((await read()).filter(turn => turn.role === "host").length, clips.length, "Each clip must save one host turn");
  console.log(JSON.stringify({ savedTurns: clips.length, remoteAudioBytes: playback.bytes, microphoneReleased: true }));
} finally {
  await browser.close();
}
