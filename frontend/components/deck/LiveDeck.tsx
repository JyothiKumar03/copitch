"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, AudioLines, LockKeyhole, Maximize, Mic, MicOff, Pause, Play, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
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
  paused: "Paused", awaiting_paint: "Waiting for the slide to display", narrating: "Narrating", listening: "Listening for your question",
  answering: "Answering", awaiting_decision: "Waiting for your decision", completed: "Presentation complete",
};
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
  const liveHeading = useRef<HTMLHeadingElement>(null);
  const holdPlayback = useRef<(() => (() => void) | undefined) | null>(null);
  const index = deck.slides.findIndex(item => item.slide_id === state?.cursor.slide_id);
  const slide = deck.revision === state?.revision ? deck.slides[index] : undefined;
  const revision = state?.revision;
  const paint = state && slide ? { sequence: state.stage_sequence, revision: state.revision, slide_id: slide.slide_id } : undefined;
  useStagePaint(stageToken, paint);

  useEffect(() => { liveHeading.current?.focus(); }, []);
  useEffect(() => {
    let showingStage = false;
    const onFullscreenChange = () => {
      const next = !!stage.current && document.fullscreenElement === stage.current;
      if (showingStage && !next) fullscreenControl.current?.focus();
      showingStage = next;
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
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
  const room = useRoomMicrophone({
    anchor: `${state?.revision ?? 0}:${state?.generation ?? 0}:${state?.cursor.slide_id ?? ""}`,
    ready: canAsk,
    playbackExpected: !!state?.attempt,
    pin: pinCurrentSlide, transcribe: runtime.transcribe, submit: runtime.turn, resumeAfterNoise: runtime.resumeAfterNoise,
  }, runtime.roomInput);
  const narration = useNarration(state?.attempt?.attempt_id, runtime.loadAudio, runtime.command, room.observeAudio);
  useEffect(() => { holdPlayback.current = narration.hold; }, [narration.hold]);
  const submitQuestion = async () => {
    const text = message.trim();
    if (!text || !canAsk || room.status === "listening" || room.status === "processing") return;
    const pin = await pinCurrentSlide();
    if (pin && await runtime.turn(pin, text)) setMessage(current => current.trim() === text ? "" : current);
  };
  const leave = () => { void runtime.leave(); };
  const toggleMic = () => { if (room.status === "off") void room.start(); else room.stop(); };
  const toggleFullscreen = async () => {
    const canvas = stage.current;
    if (!canvas) return;
    setFullscreenError("");
    try {
      if (document.fullscreenElement === canvas) await document.exitFullscreen();
      else if (!document.fullscreenElement) await canvas.requestFullscreen();
    }
    catch { setFullscreenError("Fullscreen is unavailable in this browser window."); }
  };
  const capturing = room.status === "listening" || room.status === "processing";
  const playbackAction = state?.status === "completed" ? "restart" :
    state?.status === "paused" || state?.status === "listening" ? "resume" : "pause";
  const playbackLocked = navigationLocked || playbackAction === "resume" && (capturing || runtime.turnPending);
  const pinned = state?.pin && state.pin.revision === deck.revision && state.pin.slide_id === slide?.slide_id ? state.pin : null;
  const sentenceNumber = state && state.status !== "completed" ? (pinned?.sentence_index ?? state.cursor.sentence_index) + 1 : 0;
  const sentence = slide && sentenceNumber > 0
    ? state?.attempt?.kind === "narration" ? state.attempt.text : sentenceAt(slide, sentenceNumber - 1)
    : undefined;
  const interrupted = !!pinned || capturing;
  const cue = pinned ? `Paused at sentence ${sentenceNumber}` :
    state?.status === "paused" && sentence ? `Paused at sentence ${sentenceNumber}` :
      sentence ? `Sentence ${sentenceNumber}` : null;

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.repeat || event.altKey || event.metaKey || event.ctrlKey || event.target instanceof HTMLElement &&
        event.target.closest("input, textarea, select, [contenteditable=true]")) return;
      if (event.key === "Escape" && !document.fullscreenElement) leave();
      else if (event.key.toLowerCase() === "f" && slide) void toggleFullscreen();
      else if (event.key.toLowerCase() === "m") toggleMic();
      else if (!playbackLocked && event.code === "Space" && !(event.target instanceof HTMLElement &&
        event.target.closest("button, a, [role=button]"))) void control({ kind: playbackAction });
      else if (!navigationLocked && event.key === "ArrowRight" && index < deck.slides.length - 1) void control({ kind: "next" });
      else if (!navigationLocked && event.key === "ArrowLeft" && index > 0) void control({ kind: "back" });
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  return <section className="deck-live bg-background text-foreground" aria-label="Live presentation controls">
    <div className="mx-auto max-w-[1480px]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0">
          <h2 ref={liveHeading} tabIndex={-1} className="text-2xl font-semibold tracking-[-.05em] sm:text-3xl">Live presentation</h2>
          <div role="status" className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <Badge variant={state?.status === "narrating" ? "secondary" : "outline"}
              className={cn("py-1", interrupted && "border-live/45 bg-live/10 text-live")}>
              {state?.status === "narrating" && <AudioLines size={13} aria-hidden="true" />}
              {state ? statusText[state.status] : "Opening the presentation…"}
            </Badge>
            {state && <span>Revision {state.revision}{index >= 0 ? ` · Slide ${index + 1} of ${deck.slides.length}` : ""}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
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
            <CardContent className="deck-action-row px-3 py-3 sm:px-4" aria-label="Slide controls">
              <div className="deck-tools">
                <Button size="sm" variant="outline" aria-keyshortcuts="ArrowLeft" disabled={navigationLocked || index <= 0} onClick={() => void control({ kind: "back" })}><ArrowLeft size={15} aria-hidden="true" />Back</Button>
                <Button size="sm" aria-keyshortcuts="Space" disabled={playbackLocked} onClick={() => void control({ kind: playbackAction })}>
                  {playbackAction === "pause" ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
                  {playbackAction === "restart" ? "Restart presentation" : playbackAction === "resume" ? "Resume" : "Pause"}
                </Button>
                <Button size="sm" variant="outline" aria-keyshortcuts="ArrowRight" disabled={navigationLocked || index < 0 || index >= deck.slides.length - 1} onClick={() => void control({ kind: "next" })}>Next<ArrowRight size={15} aria-hidden="true" /></Button>
                <Button size="sm" variant="ghost" disabled={navigationLocked || state?.status === "completed"} onClick={() => void control({ kind: "skip" })}>Skip slide</Button>
              </div>
              <Button ref={fullscreenControl} variant="ghost" size="sm" aria-keyshortcuts="F" disabled={!slide} onClick={() => void toggleFullscreen()}><Maximize size={15} aria-hidden="true" />Fullscreen</Button>
            </CardContent>
            {(cue || room.status !== "off") && <div className="live-sentence" data-interrupted={interrupted}>
              <div role="status" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                {cue && <span className="font-semibold"><AudioLines size={15} className="mr-1.5 inline-block align-[-.2rem]" aria-hidden="true" />{cue}</span>}
                {room.status !== "off" && <span className="text-xs text-muted-foreground">{room.status === "opening" ? "Opening microphone…" :
                  room.status === "listening" ? "Listening…" : room.status === "processing" ? "Processing your question…" : "Microphone on"}</span>}
              </div>
              {sentence && <p className="mt-1.5 max-w-[64ch] wrap-anywhere text-sm leading-relaxed text-foreground">{sentence}</p>}
            </div>}
          </Card>
          {(runtime.error || narration.error || fullscreenError) && <p role="alert" className="mt-3 text-sm text-destructive">{runtime.error ?? narration.error ?? fullscreenError}</p>}
          <p className="mt-3 hidden flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground sm:flex" aria-label="Keyboard shortcuts">
            <span><kbd>Space</kbd> Playback</span><span><kbd>← / →</kbd> Slides</span><span><kbd>F</kbd> Fullscreen</span><span><kbd>M</kbd> Microphone</span>
          </p>
        </div>
        <aside className="grid min-w-0 gap-4" aria-label="Private presenter panel">
          <Card className="gap-0 shadow-none">
            <CardHeader className="flex flex-row items-center justify-between gap-2 px-4 pb-2">
              <h3 className="text-sm font-semibold">Room microphone</h3>
              {room.status === "off" ? <MicOff size={16} className="text-muted-foreground" aria-hidden="true" /> :
                <Mic size={16} className="text-live" aria-hidden="true" />}
            </CardHeader>
            <CardContent className="grid gap-3 px-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Button type="button" variant="outline" size="sm" aria-pressed={room.status !== "off"} aria-keyshortcuts="M" onClick={toggleMic}>
                  {room.status === "off" ? "Turn microphone on" : "Turn microphone off"}
                </Button>
                {room.status === "ready" && <span className="text-xs text-muted-foreground">Speak to interrupt</span>}
                {room.error && <p role="alert" className="w-full text-destructive">{room.error}</p>}
              </div>
            </CardContent>
          </Card>
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
              <Button size="sm" type="submit" disabled={!canAsk || !message.trim() || room.status === "listening" || room.status === "processing"}>Send privately<Send size={15} aria-hidden="true" /></Button>
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
