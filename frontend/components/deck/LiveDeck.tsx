"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, AudioLines, LockKeyhole, Maximize, Mic, MicOff, Pause, Play, Send } from "lucide-react";
import { ThemeToggle } from "@/components/site/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useHoldToTalk } from "@/hooks/deck/use-hold-to-talk";
import { useNarration } from "@/hooks/deck/use-narration";
import { useRoomMicrophone } from "@/hooks/deck/use-room-microphone";
import { useStagePaint } from "@/hooks/deck/use-stage-paint";
import type { usePresentation } from "@/hooks/deck/use-presentation";
import type { TDeck, TSlide } from "@/types/deck";
import type { TPresentationAction } from "@/types/presentation";
import { cn } from "@/lib/utils";
import { slideSource } from "@/lib/slide-source";
import { Slide } from "./Slide";
import { SlideDiff } from "./SlideDiff";

const statusText = {
  paused: "Paused", awaiting_paint: "Waiting for the slide to display", narrating: "Narrating", listening: "Paused",
  answering: "Thinking…", awaiting_decision: "Change ready to review", completed: "Presentation complete",
};
const holdSpaceMs = 250;
type TVoicePress = { code: string; timer?: number; talking: boolean; release?: () => void };
const sentenceSplitter = new Intl.Segmenter(undefined, { granularity: "sentence" });
const sentenceAt = (slide: TSlide, index: number) => {
  const planned = slide.sentences;
  if (planned?.length && planned.map(sentence => sentence.text.trim()).join(" ") === slide.narration.trim().replace(/\s+/gu, " ")) {
    return planned[index]?.text;
  }
  return Array.from(sentenceSplitter.segment(slide.narration), item => item.segment.trim()).filter(Boolean)[index];
};

export const LiveDeck = ({ deck, runtime, refreshRevision, backToConversation }: {
  deck: TDeck; runtime: ReturnType<typeof usePresentation>; refreshRevision: () => void; backToConversation: () => void;
}) => {
  const { state, stageToken } = runtime;
  const [message, setMessage] = useState("");
  const [fullscreenError, setFullscreenError] = useState("");
  const stage = useRef<HTMLDivElement>(null);
  const fullscreenControl = useRef<HTMLButtonElement>(null);
  const fullscreenRequested = useRef(false);
  const holdControl = useRef<HTMLButtonElement>(null);
  const liveHeading = useRef<HTMLHeadingElement>(null);
  const holdPlayback = useRef<(() => (() => void) | undefined) | null>(null);
  const duckPlayback = useRef<(() => ((advance?: boolean) => void) | undefined) | null>(null);
  const voicePress = useRef<TVoicePress | null>(null);
  const pointerPress = useRef<number | null>(null);
  const hasHeldSpeech = useRef<(() => boolean) | null>(null);
  const index = deck.slides.findIndex(item => item.slide_id === state?.cursor.slide_id);
  const slide = deck.revision === state?.revision ? deck.slides[index] : undefined;
  const pinned = state?.pin && state.pin.revision === deck.revision && state.pin.slide_id === slide?.slide_id ? state.pin : null;
  const sentenceNumber = state && state.status !== "completed" ? (pinned?.sentence_index ?? state.cursor.sentence_index) + 1 : 0;
  const sentence = slide && sentenceNumber > 0
    ? state?.attempt?.kind === "narration" ? state.attempt.text : sentenceAt(slide, sentenceNumber - 1)
    : undefined;
  const revision = state?.revision;
  const paint = state && slide ? { sequence: state.stage_sequence, revision: state.revision, slide_id: slide.slide_id } : undefined;
  useStagePaint(stageToken, paint);

  useEffect(() => { liveHeading.current?.focus(); }, []);
  useEffect(() => {
    let restoreFocus = 0;
    const onFullscreenChange = () => {
      if (!document.fullscreenElement && !fullscreenRequested.current) return;
      cancelAnimationFrame(restoreFocus);
      if (document.fullscreenElement) return;
      fullscreenRequested.current = false;
      restoreFocus = requestAnimationFrame(() => fullscreenControl.current?.focus({ preventScroll: true }));
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      cancelAnimationFrame(restoreFocus);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);
  useEffect(() => { if (revision && revision !== deck.revision) refreshRevision(); }, [revision, deck.revision, refreshRevision]);
  const navigationLocked = runtime.pending || !!state?.proposal || !state;
  const control = async (action: TPresentationAction) => {
    const release = holdPlayback.current?.();
    const updated = await runtime.tryAction(() => runtime.command(action));
    if (!updated || updated.attempt?.attempt_id === state?.attempt?.attempt_id) release?.();
  };
  const canAsk = !navigationLocked && !runtime.turnPending && !!state?.painted && state.status !== "completed";
  const pinCurrentSlide = async () => {
    if (!state) return null;
    const release = holdPlayback.current?.();
    const interrupted = await runtime.interrupt(state);
    if (!interrupted?.pin) release?.();
    return interrupted?.pin?.pin_id ?? null;
  };
  const anchor = `${state?.revision ?? 0}:${state?.generation ?? 0}:${state?.cursor.slide_id ?? ""}:${state?.cursor.sentence_index ?? -1}`;
  const voice = { anchor, pin: pinCurrentSlide, transcribe: runtime.transcribe, submit: runtime.turn, recover: runtime.recoverInterruption };
  const room = useRoomMicrophone({
    ...voice, revision, ready: canAsk, playbackExpected: !!state?.attempt, connectRealtime: runtime.connectMicrophone,
    narration: state?.attempt?.text ?? sentence,
    duck: () => duckPlayback.current?.(),
    blocked: () => !!voicePress.current || hasHeldSpeech.current?.() === true,
  });
  const talk = useHoldToTalk({ ...voice, wasPlaying: !!state?.attempt, microphone: room.microphone });
  useEffect(() => { hasHeldSpeech.current = talk.isActive; }, [talk.isActive]);
  const narration = useNarration(state?.attempt?.attempt_id, runtime.loadAudio, runtime.command, room.observeAudio);
  useEffect(() => {
    holdPlayback.current = narration.hold;
    duckPlayback.current = narration.duck;
  }, [narration.hold, narration.duck]);
  const submitQuestion = async () => {
    const text = message.trim();
    if (!text || !canAsk || talk.isActive() || room.isCapturing()) return;
    const pin = await pinCurrentSlide();
    if (pin && await runtime.turn(pin, text)) {
      room.clearError();
      talk.clearError();
      setMessage(current => current.trim() === text ? "" : current);
    }
  };
  const leave = () => { void runtime.leave(); };
  const startTalk = () => { room.clearError(); talk.start(); };
  const toggleMic = () => { if (room.status === "off") { talk.clearError(); void room.start(); } else room.stop(); };
  const toggleFullscreen = async () => {
    const canvas = stage.current;
    if (!canvas) return;
    setFullscreenError("");
    try {
      if (document.fullscreenElement === canvas) await document.exitFullscreen();
      else if (!document.fullscreenElement && !fullscreenRequested.current) {
        fullscreenRequested.current = true;
        fullscreenControl.current?.focus({ preventScroll: true });
        await canvas.requestFullscreen();
      }
    }
    catch {
      fullscreenRequested.current = document.fullscreenElement === canvas;
      setFullscreenError("Fullscreen is unavailable in this browser window.");
    }
  };
  const capturing = room.status === "listening" || room.status === "processing" || talk.status !== "idle";
  const canStartTalk = canAsk && !capturing;
  const playbackAction = state?.status === "completed" ? "restart" :
    state?.status === "paused" || state?.status === "listening" ? "resume" : "pause";
  const stageLocked = navigationLocked || capturing || runtime.turnPending;
  const finishTalk = talk.finish;
  const interrupted = !!pinned || capturing;
  const cue = pinned ? `Paused at sentence ${sentenceNumber}` :
    state?.status === "paused" && sentence ? `Paused at sentence ${sentenceNumber}` :
      sentence ? `Sentence ${sentenceNumber}` : null;
  const status = talk.status === "listening" ? "Listening…" : room.status === "listening" ? "Hearing you…" :
    capturing || runtime.turnPending ? "Thinking…" :
      room.status === "opening" ? "Opening microphone…" :
        state?.attempt?.kind === "answer" || state?.status === "paused" && state.last_reply ? "Answer ready" :
          state ? statusText[state.status] : "Opening the presentation…";

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (event.code === voicePress.current?.code) { event.preventDefault(); return; }
      if (event.repeat || event.altKey || event.metaKey || event.ctrlKey ||
        target?.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])")) return;
      if (event.key === "Escape" && talk.status === "listening") void talk.finish(false);
      else if (event.key === "Escape" && !document.fullscreenElement && !fullscreenRequested.current) leave();
      else if (event.key.toLowerCase() === "f" && slide) void toggleFullscreen();
      else if (event.key.toLowerCase() === "m" && !talk.isActive()) toggleMic();
      else if (!stageLocked && !voicePress.current && (event.code === "Space" || event.code === "KeyB" && canStartTalk) &&
        (event.code === "KeyB" || target === holdControl.current || !target?.closest("button, a, [role=button]"))) {
        const press: TVoicePress = { code: event.code, talking: false, release: holdPlayback.current?.() };
        voicePress.current = press;
        const begin = () => {
          if (voicePress.current !== press || room.isCapturing() || talk.isActive()) return;
          press.talking = true;
          startTalk();
        };
        if (canStartTalk && (event.code === "KeyB" || target === holdControl.current)) begin();
        else if (canStartTalk) press.timer = window.setTimeout(begin, holdSpaceMs);
      }
      else if (!stageLocked && event.key === "ArrowRight" && index < deck.slides.length - 1) void control({ kind: "next" });
      else if (!stageLocked && event.key === "ArrowLeft" && index > 0) void control({ kind: "back" });
      else return;
      event.preventDefault();
    };
    const releaseKey = (event: KeyboardEvent) => {
      const press = voicePress.current;
      if (!press || event.code !== press.code) return;
      event.preventDefault();
      voicePress.current = null;
      window.clearTimeout(press.timer);
      if (press.talking) {
        press.release?.();
        void talk.finish(true);
      } else if (!stageLocked && press.code === "Space") void control({ kind: playbackAction }).finally(press.release);
      else press.release?.();
    };
    window.addEventListener("keydown", handleKey);
    window.addEventListener("keyup", releaseKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("keyup", releaseKey);
    };
  });

  useEffect(() => {
    const cancelPress = () => {
      const press = voicePress.current;
      voicePress.current = null;
      pointerPress.current = null;
      window.clearTimeout(press?.timer);
      press?.release?.();
      void finishTalk(false);
    };
    window.addEventListener("blur", cancelPress);
    return () => {
      window.removeEventListener("blur", cancelPress);
      window.clearTimeout(voicePress.current?.timer);
    };
  }, [finishTalk]);

  return <section className="deck-live bg-background text-foreground" aria-label="Live presentation controls">
    <div className="mx-auto max-w-[1480px]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0">
          <h2 ref={liveHeading} tabIndex={-1} className="text-2xl font-semibold tracking-[-.05em] sm:text-3xl">Live presentation</h2>
          {state && <p className="mt-2 text-sm text-muted-foreground">
            Revision {state.revision}{index >= 0 ? ` · Slide ${index + 1} of ${deck.slides.length}` : ""}
          </p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ThemeToggle />
          <Button variant="ghost" size="sm" disabled={runtime.pending}
            onClick={() => void runtime.leave().then(closed => { if (closed) backToConversation(); })}>Back to conversation</Button>
          <Button variant="outline" size="sm" disabled={runtime.pending} onClick={leave}>Exit live view</Button>
        </div>
      </header>
      <div className="live-console grid gap-4 pt-4 sm:gap-5">
        <div className="min-w-0">
          <Card className="live-stage-panel gap-0 overflow-hidden py-0 shadow-none">
            <div ref={stage} className="deck-canvas live-canvas stage-fullscreen">
              <div className="min-w-0 [container-type:inline-size]">
                {slide ? <Slide deck={deck} slide={slide} index={index} /> : <p className="px-4 py-6" role="status">Opening the approved slide…</p>}
              </div>
            </div>
            <CardContent className="px-3 py-3 sm:px-4">
              <div className="deck-tools" role="group" aria-label="Slide controls">
                <Button size="sm" variant="outline" aria-keyshortcuts="ArrowLeft" disabled={stageLocked || index <= 0} onClick={() => void control({ kind: "back" })}><ArrowLeft size={15} aria-hidden="true" />Back</Button>
                <Button size="sm" aria-keyshortcuts="Space" disabled={stageLocked} onClick={() => void control({ kind: playbackAction })}>
                  {playbackAction === "pause" ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
                  {playbackAction === "restart" ? "Restart presentation" : playbackAction === "resume" ? "Resume" : "Pause"}
                </Button>
                <Button ref={holdControl} type="button" size="sm" variant="outline" className={cn("touch-none select-none", talk.status === "listening" && "border-live/50 bg-live/10 text-live")}
                  aria-disabled={!canStartTalk && talk.status !== "listening"} aria-pressed={talk.status === "listening"}
                  aria-describedby="live-voice-shortcut" aria-keyshortcuts="Space B"
                  onPointerDown={event => {
                    if (event.button !== 0 || !canStartTalk || talk.isActive() || room.isCapturing() || voicePress.current) return;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    pointerPress.current = event.pointerId;
                    startTalk();
                  }}
                  onPointerUp={event => {
                    if (pointerPress.current !== event.pointerId) return;
                    pointerPress.current = null;
                    void talk.finish(true);
                  }}
                  onLostPointerCapture={event => {
                    if (pointerPress.current !== event.pointerId) return;
                    pointerPress.current = null;
                    void talk.finish(false);
                  }}
                  onClick={event => {
                    if (event.detail !== 0) return;
                    if (talk.status === "listening") void talk.finish(true);
                    else if (canStartTalk && !room.isCapturing()) startTalk();
                  }}>
                  <Mic size={15} aria-hidden="true" />Hold to talk
                </Button>
                <Button type="button" variant="outline" size="sm" aria-pressed={room.status !== "off"}
                  aria-label="Hands-free mic" aria-keyshortcuts="M" disabled={talk.status !== "idle"} onClick={toggleMic}>
                  {room.status === "off" ? <MicOff size={15} aria-hidden="true" /> : <Mic size={15} aria-hidden="true" />}
                  Hands-free {room.status === "off" ? "off" : "on"}
                </Button>
                <Button size="sm" variant="outline" aria-keyshortcuts="ArrowRight" disabled={stageLocked || index < 0 || index >= deck.slides.length - 1} onClick={() => void control({ kind: "next" })}>Next<ArrowRight size={15} aria-hidden="true" /></Button>
                <Button size="sm" variant="ghost" disabled={stageLocked || state?.status === "completed"} onClick={() => void control({ kind: "skip" })}>Skip slide</Button>
                <Button ref={fullscreenControl} variant="ghost" size="sm" aria-keyshortcuts="F" disabled={!slide} onClick={() => void toggleFullscreen()}><Maximize size={15} aria-hidden="true" />Fullscreen</Button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                <Badge role="status" variant="outline" className={cn("py-1", (status === "Listening…" || status === "Hearing you…") && "border-live/45 bg-live/10 text-live")}>
                  {status === "Narrating" && <AudioLines size={13} aria-hidden="true" />}{status}
                </Badge>
                {room.status !== "off" && room.status !== "opening" && <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {(state?.attempt ? room.meter.echoCalibrated : room.meter.quietCalibrated) ? "Mic ready" : "Calibrating mic"}
                  <meter aria-label="Microphone input level" min={0} max={100} value={Math.min(100, Math.round(room.meter.level * 1600))}
                    className="h-2 w-16 accent-primary" />
                </span>}
              </div>
              {room.status !== "off" && room.meter.missingReference && <p className="mt-2 text-sm text-muted-foreground" role="status">
                Hands-free can’t hear the narration output. Use Hold to talk or headphones.
              </p>}
              {room.status === "ready" && room.meter.tooQuiet && <p className="mt-2 text-sm text-muted-foreground" role="status">
                Too quiet. Move closer or use Hold to talk.
              </p>}
            </CardContent>
            {cue && <div className="live-sentence" data-interrupted={interrupted}>
              <span className="font-semibold"><AudioLines size={15} className="mr-1.5 inline-block align-[-.2rem]" aria-hidden="true" />{cue}</span>
              {sentence && <p className="mt-1.5 max-w-[64ch] wrap-anywhere text-sm leading-relaxed text-foreground">{sentence}</p>}
            </div>}
          </Card>
          {[...new Set([talk.error, room.error, runtime.error, narration.error, fullscreenError].filter(Boolean))].map(error =>
            <p key={error} role="alert" className="mt-3 text-sm text-destructive">{error}</p>)}
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Keyboard shortcuts">
            <span id="live-voice-shortcut">Tap <kbd>Space</kbd> for playback. Hold <kbd>Space</kbd> or <kbd>B</kbd> to talk.</span><span><kbd>← / →</kbd> Slides</span><span><kbd>F</kbd> Fullscreen</span><span><kbd>M</kbd> Hands-free</span>
          </p>
        </div>
        <aside className="grid min-w-0 gap-4" aria-label="Private presenter panel">
          {state?.proposal ? <SlideDiff proposal={state.proposal} live pending={runtime.pending} onDecision={decision => {
            const proposal = state.proposal!;
            void control({ kind: "decide", decision, proposal_id: proposal.proposal_id, slide_id: proposal.slide_id });
          }} /> : <Card className="gap-0 shadow-none">
            <CardHeader className="flex flex-row items-center justify-between gap-2 px-4 pb-2">
              <h3 className="text-sm font-semibold">Ask or correct</h3>
              <Badge variant="outline"><LockKeyhole size={12} aria-hidden="true" />Private</Badge>
            </CardHeader>
            <CardContent className="px-4"><form className="grid gap-3" onSubmit={event => { event.preventDefault(); void submitQuestion(); }}>
            <Textarea aria-label="Private question or correction" rows={3} value={message} onChange={event => setMessage(event.target.value)}
              placeholder="Ask a question or suggest a slide change" maxLength={2000} />
            <div>
              <Button size="sm" type="submit" disabled={!canAsk || !message.trim() || capturing}>Send privately<Send size={15} aria-hidden="true" /></Button>
            </div>
            {state?.last_reply && <div role="status" className="live-answer text-sm leading-relaxed">
              <p>{state.last_reply.text}</p>
              {state.last_reply.kind === "answer" && (state.last_reply.citations?.length ? <ul className="mt-2 space-y-2 text-xs">
                {state.last_reply.citations.map(({ evidence_id, excerpt }, i) => {
                  const source = slideSource(deck, evidence_id);
                  return <li key={evidence_id + i}>
                    {source.href ? <a href={source.href} target="_blank" rel="noreferrer" className="font-semibold text-evidence underline underline-offset-3">{source.label}</a> :
                      <span className="font-semibold text-evidence">{source.label}</span>}
                    <p className="mt-0.5 text-muted-foreground">“{excerpt}”</p>
                  </li>;
                })}
              </ul> : state.last_reply.evidence_ids.length > 0 && <p className="mt-2 text-xs text-evidence">{state.last_reply.evidence_ids.map(id => slideSource(deck, id).label).join(" · ")}</p>)}
            </div>}
          </form></CardContent></Card>}
        </aside>
      </div>
    </div>
  </section>;
};
