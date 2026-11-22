/**
 * Real Chrome + WebRTC voice journey against a local preview: a fake microphone plays recorded utterances, and after each
 * one the probe reports what the screen showed while speaking, the saved turns, and whether a plan or research job exists.
 * COPITCH_PROBE_WEB=http://localhost:3300 COPITCH_PROBE_API=http://localhost:3301 bun simulations/voice/live-voice-probe.ts clip0.wav clip1.wav ...
 */
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

type TProbe = { open: boolean; feed: (clip: string) => Promise<number>; stream?: MediaStream };
declare global { interface Window { voiceProbe: TProbe } }
const web = new URL(process.env.COPITCH_PROBE_WEB ?? "http://localhost:3300");
const api = new URL(process.env.COPITCH_PROBE_API ?? "http://localhost:3301");
const clips = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome", args: ["--autoplay-policy=no-user-gesture-required"] });
try {
  const context = await browser.newContext({ permissions: ["microphone"] });
  const page = await context.newPage();
  await page.addInitScript(() => {
    let audio: AudioContext;
    let destination: MediaStreamAudioDestinationNode;
    window.voiceProbe = { open: false, feed: async clip => {
      const bytes = Uint8Array.from(atob(clip), character => character.charCodeAt(0));
      const sample = audio.createBufferSource();
      sample.buffer = await audio.decodeAudioData(bytes.buffer);
      sample.connect(destination);
      sample.start();
      return sample.buffer.duration;
    } };
    navigator.mediaDevices.getUserMedia = async () => {
      audio = new AudioContext();
      await audio.resume();
      destination = audio.createMediaStreamDestination();
      const silence = audio.createConstantSource();
      silence.offset.value = 0;
      silence.connect(destination);
      silence.start();
      window.voiceProbe.stream = destination.stream;
      return destination.stream;
    };
    const Peer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Peer {
      createDataChannel(label: string, options?: RTCDataChannelInit) {
        const channel = super.createDataChannel(label, options);
        channel.addEventListener("open", () => { window.voiceProbe.open = true; });
        return channel;
      }
    };
  });
  await page.goto(new URL("/research", web).href);
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Email").fill("voice-probe-" + crypto.randomUUID() + "@example.test");
  await page.getByLabel("Password").fill(crypto.randomUUID());
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByLabel("Project name").fill("Voice probe");
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByRole("button", { name: /start voice/i }).first().click();
  await page.waitForFunction(() => window.voiceProbe.open, undefined, { timeout: 30_000 });
  const project = new URL(page.url()).searchParams.get("project")!;
  const workspace = async () => (await (await context.request.get(new URL(`/api/sessions/${project}/interview/workspace`, api).href)).json()) as
    { history?: { role: string; text: string }[]; proposal?: unknown; job?: unknown; phase?: string };
  const conversation = () => page.locator(".conversation-timeline").innerText().catch(() => "");
  await Bun.sleep(4000);
  for (const [index, file] of clips.entries()) {
    const before = (await workspace()).history?.length ?? 0;
    const duration = await page.evaluate(clip => window.voiceProbe.feed(clip), (await readFile(file)).toString("base64"));
    // Sample the screen while the host is speaking: live captions should show the words before the turn is saved.
    const seen: string[] = [];
    for (let elapsed = 0; elapsed < duration * 1000 + 1500; elapsed += 700) {
      seen.push((await conversation()).slice(-160).replace(/\s+/gu, " "));
      await Bun.sleep(700);
    }
    let state = await workspace();
    for (let waited = 0; waited < 30_000 && (state.history?.length ?? 0) <= before; waited += 1000) { await Bun.sleep(1000); state = await workspace(); }
    await Bun.sleep(9000);
    state = await workspace();
    const added = (state.history ?? []).slice(before).map(turn => `${turn.role}: ${turn.text.slice(0, 140)}`);
    const screen = await conversation();
    console.log(JSON.stringify({ clip: index, liveCaptionWhileSpeaking: seen.some((text, i) => i > 0 && text !== seen[0]), saved: added,
      phase: state.phase, proposal: !!state.proposal, job: !!state.job, startButton: await page.getByRole("button", { name: /start research/i }).count(),
      screenTail: screen.slice(-200).replace(/\s+/gu, " ") }));
  }
  if (process.env.COPITCH_PROBE_SCREENSHOT) await page.screenshot({ path: process.env.COPITCH_PROBE_SCREENSHOT });
} finally {
  await browser.close();
}
