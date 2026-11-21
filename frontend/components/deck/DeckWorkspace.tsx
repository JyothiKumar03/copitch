"use client";

import { useCallback, useState } from "react";
import { usePresentation } from "@/hooks/deck/use-presentation";
import { useDeck } from "@/hooks/deck/use-deck";
import { exportDeck } from "@/lib/export-deck";
import { slideSource } from "@/lib/slide-source";
import type { TDeckWorkspaceProps, TPitchInput } from "@/types/deck";
import { PitchForm } from "./PitchForm";
import { SlideOrder } from "./SlideOrder";
import { Slide } from "./Slide";
import { SlideDiff } from "./SlideDiff";
import { LiveDeck } from "./LiveDeck";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import "./stage.css";

export const DeckWorkspace = (props: TDeckWorkspaceProps) => {
  const { order, downloadPlan, deck, pitches, reopen, refresh, variantsError, proposal, prepare, edit, decision } = useDeck(props);
  const [preparingVariant, setPreparingVariant] = useState(false);
  const [orderIds, setOrderIds] = useState<string[] | null>(null);
  const [index, setIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [points, setPoints] = useState("");
  const [notes, setNotes] = useState("");
  const [exportError, setExportError] = useState<string | null>(null);
  const slide = deck?.slides[index];
  const runtime = usePresentation(deck, props.getSession, props.researchId);
  const { mutate: refreshDeck } = refresh;
  const deckId = deck?.deck_id;
  const refreshRevision = useCallback(() => { if (deckId) refreshDeck(deckId); }, [deckId, refreshDeck]);
  const error = order.error ?? downloadPlan.error ?? reopen.error ?? refresh.error ?? decision.error ?? edit.error ?? prepare.error ?? variantsError;
  const navigate = (direction: number) => setIndex(i => Math.max(0, Math.min((deck?.slides.length ?? 1) - 1, i + direction)));
  const resetPreview = () => {
    setOrderIds(null); order.reset(); downloadPlan.reset(); setIndex(0); setEditing(false); setPreparingVariant(false);
    edit.reset(); decision.reset();
  };
  const preparePitch = (pitch?: TPitchInput) => prepare.mutate(pitch, { onSuccess: resetPreview });
  const busy = !!orderIds || order.isPending || prepare.isPending || reopen.isPending || runtime.pending || editing || !!proposal || decision.isPending;
  const pitchPicker = pitches.length > (deck ? 1 : 0) && (
    <label className="pitch-picker text-sm font-medium">Prepared presentations
      <select className="rounded-sm border border-border bg-background px-3 py-2 text-foreground" value={deck?.deck_id ?? ""} disabled={busy} onChange={event => reopen.mutate(event.target.value, { onSuccess: resetPreview })}>
        {!deck && <option value="" disabled>Choose a saved presentation</option>}
        {pitches.map(pitch => <option key={pitch.deck_id} value={pitch.deck_id}>{pitch.label}</option>)}
      </select>
    </label>
  );

  if (deck && runtime.active) return <LiveDeck deck={deck} runtime={runtime} refreshRevision={refreshRevision} />;
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
    setTitle(slide.title); setPoints(slide.highlights.join("\n")); setNotes(slide.narration); setEditing(true);
  };
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
    <section className="space-y-5 rounded-sm border border-border bg-card p-5 text-foreground sm:p-8">
      {!deck.grounding_mode && <p role="status">This saved deck predates evidence review. Refine the brief and run research again for checked findings.</p>}
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border pb-4"><h2 className="font-display text-3xl tracking-tight sm:text-4xl">Presentation preview</h2><span className="text-sm text-muted-foreground">Revision {deck.revision}</span></div>
      <div className="pitch-preview">
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
      </div>
      <Slide deck={deck} slide={slide} index={index} />
      <section className="pitch-notes border-l-2 border-primary bg-muted px-4 py-3">
        <h3>Private narration</h3><p>{slide.narration}</p>
        {!!slide.evidence_ids.length && <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Slide sources">{slide.evidence_ids.map(id => {
          const source = slideSource(deck, id);
          return <li key={id}>{source.href ? <a href={source.href} target="_blank" rel="noreferrer" className="underline underline-offset-2">{source.label}</a> : source.label}</li>;
        })}</ul>}
      </section>
      <div className="deck-tools" aria-label="Presentation controls">
        <Button variant="outline" disabled={locked || index === 0} onClick={() => navigate(-1)}>Previous</Button>
        <Button variant="outline" disabled={locked || index === deck.slides.length - 1} onClick={() => navigate(1)}>Next</Button>
        <Button disabled={locked} onClick={() => void runtime.enter()}>{runtime.pending ? "Opening…" : runtime.state?.revision === deck.revision ? "Open live controls" : "Approve and present"}</Button>
        <Button variant="outline" disabled={locked} onClick={beginEdit}>Edit slide</Button>
        <Button variant="outline" disabled={locked || deck.slides.length < 2} onClick={() => { order.reset(); setPreparingVariant(false); setOrderIds(deck.slides.map(item => item.slide_id)); }}>Reorder slides</Button>
        <Button variant="outline" disabled={downloadPlan.isPending || !!orderIds} onClick={() => downloadPlan.mutate()}>{downloadPlan.isPending ? "Downloading…" : "Download plan (JSON)"}</Button>
        <Button variant="outline" onClick={() => {
          setExportError(null);
          void exportDeck(deck).catch(() => setExportError("The offline presentation could not be downloaded. Try again."));
        }}>Download offline slides</Button>
      </div>
      {orderIds && <SlideOrder deck={deck} ids={orderIds} pending={order.isPending || reopen.isPending}
        onChange={setOrderIds} onCancel={() => { setOrderIds(null); order.reset(); }}
        onSave={() => order.mutate(orderIds, { onSuccess: restoreCursor })}
        onReload={order.isError ? () => reopen.mutate(deck.deck_id, { onSuccess: restoreCursor }) : undefined} />}
      {runtime.error && <p role="alert" className="mt-3 text-sm text-destructive">{runtime.error}</p>}
      {exportError && <p role="alert" className="mt-3 text-sm text-destructive">{exportError}</p>}
      {error && <p role="alert" className="mt-3 border-l-2 border-primary pl-3 text-sm font-medium">{error.message}</p>}
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
        {proposal && <SlideDiff proposal={proposal} pending={decision.isPending} onDecision={choice => decision.mutate(choice)} />}
    </section>
  );
};
