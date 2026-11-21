"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAudience } from "@/hooks/deck/use-audience";
import { useDeck } from "@/hooks/deck/use-deck";
import { exportDeck } from "@/lib/export-deck";
import type { TDeckWorkspaceProps, TPitchInput } from "@/types/deck";
import { PitchForm } from "./PitchForm";
import { SlideOrder } from "./SlideOrder";
import { Slide } from "./Slide";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import "./stage.css";

export const DeckWorkspace = (props: TDeckWorkspaceProps) => {
  const { order, downloadPlan, turn, deck, pitches, reopen, proposal, prepare, edit, decision, start, mark, coverage } = useDeck(props);
  const [preparingVariant, setPreparingVariant] = useState(false);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [orderIds, setOrderIds] = useState<string[] | null>(null);
  const [index, setIndex] = useState(0);
  const [live, setLive] = useState(false);
  const [held, setHeld] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [resumeAfterEdit, setResumeAfterEdit] = useState(false);
  const [title, setTitle] = useState("");
  const [points, setPoints] = useState("");
  const [notes, setNotes] = useState("");
  const speechEpoch = useRef(0);
  const slide = deck?.slides[index];
  const audience = useAudience({ getSession: props.getSession, deck, slideId: slide?.slide_id, live });
  const error = order.error ?? downloadPlan.error ?? reopen.error ?? turn.error ?? mark.error ?? start.error ?? decision.error ?? edit.error ?? prepare.error;
  const stop = useCallback(() => {
    speechEpoch.current++;
    window.speechSynthesis?.cancel();
    setSpeaking(false);
    setHeld(false);
  }, []);
  const navigate = useCallback((direction: number) => {
    stop();
    setAsking(false);
    setIndex(i => Math.max(0, Math.min((deck?.slides.length ?? 1) - 1, i + direction)));
  }, [deck, stop]);
  const narrate = useCallback(() => {
    if (!slide || !window.speechSynthesis || !slide.narration) return;
    stop();
    const epoch = speechEpoch.current;
    const speech = new SpeechSynthesisUtterance(slide.narration);
    speech.onend = speech.onerror = () => { if (speechEpoch.current === epoch) { setSpeaking(false); setHeld(false); } };
    setSpeaking(true);
    window.speechSynthesis.resume();
    window.speechSynthesis.speak(speech);
  }, [slide, stop]);
  const toggleNarration = useCallback(() => {
    if (held) {
      window.speechSynthesis?.resume(); setHeld(false); setSpeaking(true);
    } else if (speaking) {
      window.speechSynthesis?.pause(); setHeld(true); setSpeaking(false);
    } else narrate();
  }, [held, speaking, narrate]);
  useEffect(() => () => { speechEpoch.current++; window.speechSynthesis?.cancel(); }, []);
  useEffect(() => {
    if (!live) return;
    const keyboard = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
      if (event.key === "Escape") { stop(); setLive(false); }
      else if (event.key === "ArrowRight") navigate(1);
      else if (event.key === "ArrowLeft") navigate(-1);
      else if (event.code === "Space" && !(event.target instanceof HTMLButtonElement)) {
        toggleNarration();
      } else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [live, stop, toggleNarration, navigate]);

  const resetPreview = () => {
    stop(); setOrderIds(null); order.reset(); downloadPlan.reset(); setIndex(0); setAsking(false); setEditing(false); setPreparingVariant(false);
    setResumeAfterEdit(false); setLive(false); turn.reset(); edit.reset(); decision.reset(); start.reset(); mark.reset();
  };
  const preparePitch = (pitch?: TPitchInput) => prepare.mutate(pitch, { onSuccess: resetPreview });
  const busy = !!orderIds || order.isPending || prepare.isPending || reopen.isPending || turn.isPending || start.isPending || editing || !!proposal || decision.isPending;
  const pitchPicker = pitches.length > (deck ? 1 : 0) && (
    <label className="pitch-picker text-sm font-medium">Prepared presentations
      <select className="rounded-sm border border-border bg-background px-3 py-2 text-foreground" value={deck?.deck_id ?? ""} disabled={busy} onChange={event => reopen.mutate(event.target.value, { onSuccess: resetPreview })}>
        {!deck && <option value="" disabled>Choose a saved presentation</option>}
        {pitches.map(pitch => <option key={pitch.deck_id} value={pitch.deck_id}>{pitch.label}</option>)}
      </select>
    </label>
  );

  if (!deck || !slide) return (
    <section className="space-y-5 rounded-sm border border-border bg-card p-5 text-foreground sm:p-8">
      <h2 className="font-display text-3xl tracking-tight sm:text-4xl">Prepare your presentation</h2>
      <PitchForm pending={busy} onPrepare={preparePitch} />
      {pitchPicker}
      <Button variant="outline" type="button" disabled={busy} onClick={() => preparePitch()}>Open original research slides</Button>
      {error && <p role="alert">{error.message}</p>}
    </section>
  );
  const beginEdit = () => {
    if (!slide) return;
    stop();
    setResumeAfterEdit(live);
    setLive(false);
    setTitle(slide.title); setPoints(slide.highlights.join("\n")); setNotes(slide.narration); setEditing(true);
  };
  const present = () => {
    start.mutate(undefined, { onSuccess: () => { setLive(true); setAsking(false); setResumeAfterEdit(false); } });
  };
  const skipped = coverage?.points.find(point => point.point_id === slide.slide_id)?.skipped;
  const highlights = points.split("\n").map(point => point.trim()).filter(Boolean);
  const validChanges = !!title.trim() && !!notes.trim() && highlights.length > 0 && highlights.length <= 4 &&
    highlights.every(point => point.length <= 240) && (title.trim() !== slide.title || notes.trim() !== slide.narration ||
    JSON.stringify(highlights) !== JSON.stringify(slide.highlights));
  const restoreCursor = (next: typeof deck) => {
    const nextIndex = next.slides.findIndex(item => item.slide_id === slide.slide_id);
    setIndex(Math.max(0, nextIndex)); setOrderIds(null); order.reset();
  };
  const demo = deck.pitch?.demo;
  const anchorIndex = demo ? deck.slides.findIndex(item => item.slide_id === demo.after_slide_id) : -1;
  const locked = busy;
  return (
    <section className={live ? "deck-live bg-background text-foreground" : "space-y-5 rounded-sm border border-border bg-card p-5 text-foreground sm:p-8"}>
      {!live && !deck.grounding_mode && <p role="status">This saved deck predates evidence review. Refine the brief and run research again for checked findings.</p>}
      {!live && <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border pb-4"><h2 className="font-display text-3xl tracking-tight sm:text-4xl">Presentation preview</h2><span className="text-sm text-muted-foreground">Revision {deck.revision}</span></div>}
      {!live && <div className="pitch-preview">
        {pitchPicker}
        {deck.pitch && <div className="pitch-plan border-y border-border py-4">
          <div><h3>Audience</h3><p>{deck.pitch.audience}</p></div>
          <div><h3>Speaking time</h3><p>{Math.floor(deck.pitch.estimated_seconds / 60)}m {Math.round(deck.pitch.estimated_seconds % 60)}s estimated · {deck.pitch.duration_minutes} min requested</p></div>
          <div><h3>Slides</h3><p>{deck.slides.length} prepared{deck.pitch.slide_count ? " · " + deck.pitch.slide_count + " requested" : ""}</p></div>
          {demo && <div className="pitch-rationale"><h3>Demo cue · {demo.seconds}s</h3>
            <p>{anchorIndex >= 0 ? `After slide ${anchorIndex + 1}, “${deck.slides[anchorIndex].title}”` : "Placement not specified"}</p>
            <p>{demo.objective}</p><p className="break-all">{demo.url}</p>
          </div>}
          <div className="pitch-rationale"><h3>Story rationale</h3><p>{deck.pitch.rationale}</p></div>
        </div>}
        <Button variant="outline" type="button" aria-expanded={preparingVariant} disabled={locked} onClick={() => setPreparingVariant(!preparingVariant)}>
          {preparingVariant ? "Close pitch settings" : "Change audience or duration"}
        </Button>
        {preparingVariant && <PitchForm key={deck.deck_id} initial={deck.pitch} pending={locked} onPrepare={preparePitch} />}
      </div>}
      <Slide deck={deck} slide={slide} index={index} />
      {!live && <section className="pitch-notes border-l-2 border-primary bg-muted px-4 py-3"><h3>Private speaker notes</h3><p>{slide.narration}</p></section>}
      <div className="deck-tools" aria-label="Presentation controls">
        <Button variant="outline" disabled={locked || index === 0} onClick={() => navigate(-1)}>Previous</Button>
        <Button variant="outline" disabled={locked || index === deck.slides.length - 1} onClick={() => navigate(1)}>Next</Button>
        {live ? <>
          <Button variant="outline" disabled={!slide.narration || !("speechSynthesis" in window)} onClick={toggleNarration}>{speaking ? "Hold narration" : held ? "Resume narration" : "Narrate slide"}</Button>
          <Button variant="outline" onClick={beginEdit}>Hold and edit privately</Button>
          <Button variant="outline" onClick={() => { stop(); setLive(false); setResumeAfterEdit(true); setAsking(true); setQuestion(""); turn.reset(); }}>Ask or correct</Button>
          {coverage && <Button variant="outline" disabled={mark.isPending} onClick={() => {
            stop();
            mark.mutate({ pointId: slide.slide_id, kind: skipped ? "revisit" : "skip" }, {
              onSuccess(next) {
                if (!skipped && next.next.kind !== "done") {
                  const nextId = next.next.point_id;
                  const nextIndex = deck.slides.findIndex(s => s.slide_id === nextId);
                  if (nextIndex >= 0) setIndex(nextIndex);
                }
              },
            });
          }}>{skipped ? "Revisit point" : "Skip point"}</Button>}
          <Button variant="outline" onClick={() => { stop(); setLive(false); }}>End presentation</Button>
        </> : <>
          <Button disabled={locked} onClick={present}>{start.isPending ? "Opening…" : resumeAfterEdit ? "Resume presentation" : "Present"}</Button>
          <Button variant="outline" disabled={locked} onClick={beginEdit}>Edit slide</Button>
          <Button variant="outline" disabled={locked || deck.slides.length < 2} onClick={() => { order.reset(); setPreparingVariant(false); setOrderIds(deck.slides.map(item => item.slide_id)); }}>Reorder slides</Button>
          <Button variant="outline" disabled={downloadPlan.isPending || !!orderIds} onClick={() => downloadPlan.mutate()}>{downloadPlan.isPending ? "Downloading…" : "Download plan (JSON)"}</Button>
          <Button variant="outline" onClick={() => exportDeck(deck)}>Download offline slides</Button>
        </>}
        {live && <Button variant="outline" disabled={audience.opening} onClick={audience.openAudience}>Open audience screen</Button>}
      </div>
      {!live && orderIds && <SlideOrder deck={deck} ids={orderIds} pending={order.isPending || reopen.isPending}
        onChange={setOrderIds} onCancel={() => { setOrderIds(null); order.reset(); }}
        onSave={() => order.mutate(orderIds, { onSuccess: restoreCursor })}
        onReload={order.isError ? () => reopen.mutate(deck.deck_id, { onSuccess: restoreCursor }) : undefined} />}
      {audience.error && <p role="alert" className="mt-3 border-l-2 border-primary pl-3 text-sm font-medium">{String(audience.error)}</p>}
      {error && <p role="alert" className="mt-3 border-l-2 border-primary pl-3 text-sm font-medium">{error.message}</p>}
      {!live && <>
        {asking && !proposal && <form className="deck-edit border-t border-border pt-5" onSubmit={event => {
          event.preventDefault();
          if (question.trim()) turn.mutate({ turn_id: crypto.randomUUID(), base_revision: deck.revision,
            slide_id: slide.slide_id, message: question.trim() }, { onSuccess() { setQuestion(""); } });
        }}>
          <label>Private question or correction<Textarea rows={2} value={question} onChange={event => setQuestion(event.target.value)} /></label>
          <div className="deck-tools"><Button type="submit" disabled={!question.trim() || turn.isPending}>{turn.isPending ? "Checking…" : "Send to presenter"}</Button></div>
          {turn.data && <p role="status">{turn.data.text}{turn.data.kind === "answer" && turn.data.evidence_ids.length > 0 && <span className="block text-sm">Sources · {turn.data.evidence_ids.join(", ")}</span>}</p>}
        </form>}
        {editing && !proposal && <form className="deck-edit border-t border-border pt-5" onSubmit={event => {
          event.preventDefault();
          edit.mutate({ command_id: crypto.randomUUID(), base_revision: deck.revision, slide_id: slide.slide_id,
            changes: { title: title.trim(), highlights, narration: notes.trim() } },
            { onSuccess: () => setEditing(false) });
        }}>
          <label>Slide title<Input required maxLength={160} value={title} onChange={e => setTitle(e.target.value)} /></label>
          <label>Highlights (1–4 lines, up to 240 characters each)<Textarea rows={3} value={points} onChange={e => setPoints(e.target.value)} /></label>
          <label>Speaker notes<Textarea required maxLength={12000} rows={3} value={notes} onChange={e => setNotes(e.target.value)} /></label>
          <div className="deck-tools"><Button type="submit" disabled={edit.isPending || !validChanges}>Review changes</Button><Button variant="outline" type="button" disabled={edit.isPending} onClick={() => setEditing(false)}>Cancel</Button></div>
        </form>}
        {proposal && <div className="deck-edit border-t border-border pt-5">
          <h3 className="font-display text-2xl">Review private changes</h3>
          <div className="deck-diff">{(["before", "after"] as const).map(side => <section key={side} className={side === "after" ? "border-primary bg-muted" : "border-border bg-background"}>
            <h4 className="mb-2 font-semibold">{side === "before" ? "Current slide" : "Proposed slide"}</h4>
            <p>{proposal[side].title}</p><ul className="list-disc pl-5">{proposal[side].highlights.map((point, i) => <li key={i}>{point}</li>)}</ul>
            <p className="mt-2 text-sm">{proposal[side].narration}</p>
          </section>)}</div>
          <div className="deck-tools"><Button disabled={decision.isPending} onClick={() => decision.mutate("approve")}>Approve revision</Button><Button variant="outline" disabled={decision.isPending} onClick={() => decision.mutate("reject")}>Reject changes</Button></div>
        </div>}
      </>}
    </section>
  );
};
