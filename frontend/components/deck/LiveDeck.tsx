"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useNarration } from "@/hooks/deck/use-narration";
import { usePresentationMic } from "@/hooks/deck/use-presentation-mic";
import { useRoomMicrophone } from "@/hooks/deck/use-room-microphone";
import { useStagePaint } from "@/hooks/deck/use-stage-paint";
import type { usePresentation } from "@/hooks/deck/use-presentation";
import type { TDeck } from "@/types/deck";
import type { TPresentationAction } from "@/types/presentation";
import { Slide } from "./Slide";
import { SlideDiff } from "./SlideDiff";

const statusText = {
  paused: "Paused", awaiting_paint: "Waiting for the slide to display", narrating: "Narrating", listening: "Listening for your question",
  answering: "Answering", awaiting_decision: "Waiting for your decision", completed: "Presentation complete",
};

export const LiveDeck = ({ deck, runtime, refreshRevision }: {
  deck: TDeck; runtime: ReturnType<typeof usePresentation>; refreshRevision: () => void;
}) => {
  const { state, stage } = runtime;
  const [message, setMessage] = useState("");
  const [linkNotice, setLinkNotice] = useState("");
  const question = useRef<HTMLTextAreaElement>(null);
  const haltPlayback = useRef<(() => void) | null>(null);
  const index = deck.slides.findIndex(item => item.slide_id === state?.cursor.slide_id);
  const slide = deck.revision === state?.revision ? deck.slides[index] : undefined;
  const revision = state?.revision;
  const paint = state && slide ? { sequence: state.stage_sequence, revision: state.revision, slide_id: slide.slide_id } : undefined;
  useStagePaint(stage && !stage.external ? stage.token : undefined, paint);

  useEffect(() => { if (revision && revision !== deck.revision) refreshRevision(); }, [revision, deck.revision, refreshRevision]);
  const navigationLocked = runtime.pending || !!state?.proposal || !state;
  const control = (action: TPresentationAction) => {
    haltPlayback.current?.();
    return runtime.tryAction(() => runtime.command(action));
  };
  const pinCurrentSlide = async () => {
    if (state?.status === "listening" && state.pin) return state.pin.pin_id;
    const held = await control({ kind: "interrupt", attempt_id: state?.attempt?.attempt_id });
    return held?.pin?.pin_id ?? null;
  };
  const mic = usePresentationMic(pinCurrentSlide, runtime.transcribe, runtime.turn);
  const room = useRoomMicrophone({
    anchor: `${state?.revision ?? 0}:${state?.cursor.slide_id ?? ""}`,
    ready: !navigationLocked && mic.status === "idle" && !!state && state.status !== "awaiting_paint" && state.status !== "completed",
    pin: pinCurrentSlide, transcribe: runtime.transcribe, submit: runtime.turn, resumeAfterNoise: runtime.resumeAfterNoise,
  });
  const narration = useNarration(state?.attempt?.attempt_id, runtime.loadAudio, runtime.command, room.observeAudio);
  useEffect(() => { haltPlayback.current = narration.stop; }, [narration.stop]);
  const beginQuestion = async () => {
    if (await pinCurrentSlide()) question.current?.focus();
  };
  const submitQuestion = async () => {
    const text = message.trim();
    if (!text) return;
    const pin = await pinCurrentSlide();
    if (pin && await runtime.turn(pin, text)) setMessage("");
  };
  const leave = () => { narration.stop(); void runtime.leave(); };
  const moveStage = (external: boolean) => {
    narration.stop();
    void runtime.moveStage(external, external);
  };
  const copyLink = async () => {
    let token = stage?.external ? stage.token : undefined;
    if (!token) { narration.stop(); token = (await runtime.moveStage(true)) ?? undefined; }
    if (!token) return;
    const href = location.origin + "/audience#" + token;
    try { await navigator.clipboard.writeText(href); setLinkNotice("Audience link copied."); }
    catch { setLinkNotice(href); }
  };

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.repeat || event.altKey || event.metaKey || event.ctrlKey || event.target instanceof HTMLElement &&
        event.target.closest("input, textarea, select, button, [contenteditable=true]")) return;
      if (event.key === "Escape") leave();
      else if (!navigationLocked && event.key === "ArrowRight" && index < deck.slides.length - 1) void control({ kind: "next" });
      else if (!navigationLocked && event.key === "ArrowLeft" && index > 0) void control({ kind: "back" });
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  return <section className="deck-live bg-background text-foreground" aria-label="Live presentation controls">
    <div className="mx-auto max-w-[1600px]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div><h2 className="font-display text-3xl tracking-tight">Live presentation</h2>
          <p role="status" className="mt-1 text-sm text-muted-foreground">{state ? `${statusText[state.status]} · Revision ${state.revision}` : "Opening the presentation…"}</p></div>
        <Button variant="outline" size="sm" disabled={runtime.pending} onClick={leave}>Exit live view</Button>
      </header>
      <div className="live-console grid gap-6 pt-5">
        <div className="min-w-0">
          {slide ? <Slide deck={deck} slide={slide} index={index} /> : <p className="border-y border-border py-6" role="status">Opening the approved slide…</p>}
          <div className="deck-tools" aria-label="Slide controls">
            <Button variant="outline" disabled={navigationLocked || index <= 0} onClick={() => void control({ kind: "back" })}>Back</Button>
            <Button variant="outline" disabled={navigationLocked || index < 0 || index >= deck.slides.length - 1} onClick={() => void control({ kind: "next" })}>Next</Button>
            {state?.status === "completed" ? <Button disabled={navigationLocked} onClick={() => void control({ kind: "restart" })}>Restart presentation</Button> :
              state?.status === "paused" || state?.status === "listening" ? <Button disabled={navigationLocked} onClick={() => void control({ kind: "resume" })}>Resume</Button> :
              <Button disabled={navigationLocked} onClick={() => void control({ kind: "pause" })}>Pause</Button>}
            <Button variant="ghost" disabled={navigationLocked || state?.status === "completed"} onClick={() => void control({ kind: "skip" })}>Skip slide</Button>
            <label className="ml-auto flex items-center gap-2 text-sm">Go to slide
              <select aria-label="Go to slide" className="max-w-44 rounded-md border border-border bg-background p-2 text-sm" value={state?.cursor.slide_id ?? ""}
                disabled={navigationLocked} onChange={event => void control({ kind: "go_to", slide_id: event.target.value })}>
                {deck.slides.map((item, i) => <option key={item.slide_id} value={item.slide_id}>{i + 1}. {item.title}</option>)}
              </select>
            </label>
          </div>
          {(runtime.error || narration.error) && <p role="alert" className="mt-3 text-sm text-destructive">{runtime.error ?? narration.error}</p>}
        </div>
        <aside className="space-y-5 border-t border-border pt-5 lg:border-t-0 lg:pt-0" aria-label="Private presenter panel">
          <div className="space-y-2 border-b border-border pb-4">
            <h3 className="font-display text-xl">Audience screen</h3>
            <p className="text-sm text-muted-foreground">{stage?.external ? "Following the separate audience screen." : "This preview is your audience screen."}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={runtime.pending} onClick={() => moveStage(true)}>Open audience screen</Button>
              <Button variant="ghost" size="sm" disabled={runtime.pending} onClick={() => void copyLink()}>Copy audience link</Button>
              {stage?.external && <Button variant="ghost" size="sm" disabled={runtime.pending} onClick={() => moveStage(false)}>Use this screen</Button>}
            </div>
            {linkNotice && <p role="status" className="break-all text-xs text-muted-foreground">{linkNotice}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-b border-border pb-4 text-sm">
            <Button type="button" variant="outline" size="sm" aria-pressed={room.status !== "off"} disabled={mic.status !== "idle"}
              onClick={() => room.status === "off" ? void room.start() : room.stop()}>
              {room.status === "off" ? "Turn on room microphone" : "Turn off room microphone"}
            </Button>
            {room.status !== "off" && <span role="status" className="text-muted-foreground">{room.status === "opening" ? "Opening microphone…" :
              room.status === "listening" ? "Listening…" : room.status === "processing" ? "Transcribing…" : "Room mic on"}</span>}
            {room.error && <p role="alert" className="w-full text-destructive">{room.error}</p>}
          </div>
          {state?.proposal ? <SlideDiff proposal={state.proposal} live pending={runtime.pending} onDecision={decision => {
            const proposal = state.proposal!;
            void control({ kind: "decide", decision, proposal_id: proposal.proposal_id, slide_id: proposal.slide_id });
          }} /> : <form className="space-y-3" onSubmit={event => { event.preventDefault(); void submitQuestion(); }}>
            <h3 className="font-display text-xl">Ask or correct</h3>
            <Textarea ref={question} aria-label="Private question or correction" rows={3} value={message} onChange={event => setMessage(event.target.value)}
              placeholder="Ask a question or suggest a slide change" maxLength={2000} />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" type="button" size="sm" disabled={runtime.pending || !state || mic.status !== "idle"} onClick={() => void beginQuestion()}>Interrupt</Button>
              <Button variant="outline" type="button" size="sm" disabled={mic.status !== "recording" && (runtime.pending || !state || mic.status !== "idle")}
                onClick={() => { if (mic.status === "recording") mic.stop(); else { room.stop(); void mic.start(); } }}>
                {mic.status === "recording" ? "Stop and send recording" : mic.status === "transcribing" ? "Transcribing…" : mic.status === "opening" ? "Opening microphone…" : "Talk"}
              </Button>
              <Button size="sm" type="submit" disabled={runtime.pending || !message.trim() || mic.status !== "idle"}>Send privately</Button>
            </div>
            {mic.error && <p role="alert" className="text-sm text-destructive">{mic.error}</p>}
            {state?.last_reply && <div role="status" className="border-l-2 border-primary pl-3 text-sm leading-relaxed">
              <p>{state.last_reply.text}</p>
              {state.last_reply.kind === "answer" && (state.last_reply.citations?.length ? <ul className="mt-2 space-y-1 text-muted-foreground">
                {state.last_reply.citations.map(({ evidence_id, excerpt }, i) => <li key={evidence_id + i}>{evidence_id} · {excerpt}</li>)}
              </ul> : <p className="text-muted-foreground">{state.last_reply.evidence_ids.length ? "Sources · " + state.last_reply.evidence_ids.join(", ") : ""}</p>)}
            </div>}
          </form>}
          {state?.attempt?.text && <section className="border-t border-border pt-4 text-sm leading-relaxed">
            <h3 className="mb-1 font-semibold">Private narration</h3>
            <p>{state.attempt.text}</p>
          </section>}
        </aside>
      </div>
    </div>
  </section>;
};
