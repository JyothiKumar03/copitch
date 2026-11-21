"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { ArrowDownToLine, ArrowLeft, ArrowRight, FileCode2, ListOrdered, LockKeyhole, PencilLine, Play, SlidersHorizontal } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
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
  const [previewFocusRequest, requestPreviewFocus] = useReducer((request: number) => request + 1, 0);
  const lastPreviewFocus = useRef(0);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const slide = deck?.slides[index];
  const runtime = usePresentation(deck, props.getSession, props.researchId);
  const { mutate: refreshDeck } = refresh;
  const deckId = deck?.deck_id;
  const refreshRevision = useCallback(() => { if (deckId) refreshDeck(deckId); }, [deckId, refreshDeck]);
  useEffect(() => {
    const heading = previewHeading.current;
    if (!heading || previewFocusRequest === lastPreviewFocus.current) return;
    lastPreviewFocus.current = previewFocusRequest;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ block: "start", behavior: "instant" });
  }, [deck, previewFocusRequest]);
  const error = order.error ?? downloadPlan.error ?? reopen.error ?? refresh.error ?? decision.error ?? edit.error ?? prepare.error ?? variantsError;
  const navigate = (direction: number) => setIndex(i => Math.max(0, Math.min((deck?.slides.length ?? 1) - 1, i + direction)));
  const resetPreview = () => {
    setOrderIds(null); order.reset(); downloadPlan.reset(); setIndex(0); setEditing(false); setPreparingVariant(false);
    edit.reset(); decision.reset(); requestPreviewFocus();
  };
  const preparePitch = (pitch?: TPitchInput) => prepare.mutate(pitch, { onSuccess: resetPreview });
  const busy = !!orderIds || order.isPending || prepare.isPending || reopen.isPending || runtime.pending || editing || !!proposal || decision.isPending;
  const pitchPicker = pitches.length > (deck ? 1 : 0) && (
    <label className="grid min-w-0 gap-1.5 text-sm font-medium">Prepared presentations
      <NativeSelect className="w-full min-w-0" value={deck?.deck_id ?? ""} disabled={busy} onChange={event => reopen.mutate(event.target.value, { onSuccess: resetPreview })}>
        {!deck && <NativeSelectOption value="" disabled>Choose a saved presentation</NativeSelectOption>}
        {pitches.map(pitch => <NativeSelectOption key={pitch.deck_id} value={pitch.deck_id}>{pitch.label}</NativeSelectOption>)}
      </NativeSelect>
    </label>
  );

  if (deck && runtime.active) return <LiveDeck deck={deck} runtime={runtime} refreshRevision={refreshRevision} />;
  if (!deck || !slide) return (
    <section className="deck-workspace text-foreground">
      <Card className="shadow-sm">
        <CardHeader>
          <h2 className="font-display text-3xl leading-tight tracking-tight">Prepare your presentation</h2>
        </CardHeader>
        <CardContent className="grid gap-5">
          <PitchForm pending={busy} onPrepare={preparePitch} />
          <div className="grid justify-items-start gap-3 border-t border-border pt-4">
            {pitchPicker}
            <Button variant="outline" size="sm" type="button" disabled={busy} onClick={() => preparePitch()}>Open original research slides</Button>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
        </CardContent>
      </Card>
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
    <Dialog open={editing && !proposal} onOpenChange={open => { if (!open && !edit.isPending) setEditing(false); }}>
    <section className="deck-workspace grid gap-4 text-foreground">
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <h2 ref={previewHeading} tabIndex={-1} className="scroll-mt-4 font-display text-3xl leading-tight tracking-tight">Presentation preview</h2>
          <Badge variant="outline">Revision {deck.revision}</Badge>
        </CardHeader>
        <CardContent className="grid gap-4">
          {!deck.grounding_mode && <p role="status" className="border-l-2 border-primary bg-muted px-3 py-2 text-sm">This saved deck predates evidence review. Refine the brief and run research again for checked findings.</p>}
          <div className="deck-canvas"><Slide deck={deck} slide={slide} index={index} /></div>
          <div className="deck-action-row" aria-label="Presentation controls">
            <div className="deck-tools">
              <Button variant="outline" size="sm" disabled={locked || index === 0} onClick={() => navigate(-1)}><ArrowLeft size={15} aria-hidden="true" />Previous</Button>
              <Button variant="outline" size="sm" disabled={locked || index === deck.slides.length - 1} onClick={() => navigate(1)}>Next<ArrowRight size={15} aria-hidden="true" /></Button>
            </div>
            <Button size="sm" disabled={locked} onClick={() => void runtime.enter()}><Play size={15} aria-hidden="true" />{runtime.pending ? "Opening…" : runtime.state?.revision === deck.revision ? "Open live controls" : "Approve and present"}</Button>
          </div>
          <div className="deck-tools border-t border-border pt-3">
            <DialogTrigger asChild><Button size="sm" variant="ghost" disabled={locked} onClick={beginEdit}><PencilLine size={15} aria-hidden="true" />Edit slide</Button></DialogTrigger>
            <Button size="sm" variant="ghost" disabled={locked || deck.slides.length < 2} onClick={() => { order.reset(); setPreparingVariant(false); setOrderIds(deck.slides.map(item => item.slide_id)); }}><ListOrdered size={15} aria-hidden="true" />Reorder slides</Button>
            <Button size="sm" variant="ghost" onClick={() => {
              setExportError(null);
              void exportDeck(deck).catch(() => setExportError("The offline presentation could not be downloaded. Try again."));
            }}><ArrowDownToLine size={15} aria-hidden="true" />Download offline slides</Button>
            <Button size="sm" variant="ghost" disabled={downloadPlan.isPending || !!orderIds} onClick={() => downloadPlan.mutate()}><FileCode2 size={15} aria-hidden="true" />{downloadPlan.isPending ? "Downloading…" : "Download plan (JSON)"}</Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <LockKeyhole size={15} className="text-primary" aria-hidden="true" />
          <h3 className="font-semibold">Private narration</h3>
        </CardHeader>
        <CardContent className="pitch-notes pt-2">
          <p>{slide.narration}</p>
          {!!slide.evidence_ids.length && <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Slide sources">{slide.evidence_ids.map(id => {
            const source = slideSource(deck, id);
            return <li key={id}>{source.href ? <a href={source.href} target="_blank" rel="noreferrer" className="underline underline-offset-2">{source.label}</a> : source.label}</li>;
          })}</ul>}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="grid gap-4">
          {pitchPicker}
          {deck.pitch && <div className="pitch-plan">
            <div><h3>Audience</h3><p>{deck.pitch.audience}</p></div>
            <div><h3>Speaking time</h3><p>{Math.floor(deck.pitch.estimated_seconds / 60)}m {Math.round(deck.pitch.estimated_seconds % 60)}s estimated · {deck.pitch.duration_minutes} min requested</p></div>
            <div><h3>Slides</h3><p>{deck.slides.length} prepared{deck.pitch.slide_count ? " · " + deck.pitch.slide_count + " requested" : ""}</p></div>
            {demo && <div className="pitch-rationale"><h3>Demo cue · {demo.seconds}s</h3>
              <p>{anchorIndex >= 0 ? `After slide ${anchorIndex + 1}, “${deck.slides[anchorIndex].title}”` : "Placement not specified"}</p>
              <p>{demo.objective}</p><p className="break-all">{demo.url}</p>
            </div>}
            <div className="pitch-rationale"><h3>Story rationale</h3><p>{deck.pitch.rationale}</p></div>
          </div>}
          <Collapsible open={preparingVariant} onOpenChange={setPreparingVariant}>
            <CollapsibleTrigger asChild>
              <Button size="sm" variant="outline" type="button" disabled={locked}><SlidersHorizontal size={15} aria-hidden="true" />{preparingVariant ? "Close pitch settings" : "Change audience or duration"}</Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-4">
              <PitchForm key={deck.deck_id} initial={deck.pitch} pending={locked} onPrepare={preparePitch} />
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>
      {orderIds && <SlideOrder deck={deck} ids={orderIds} pending={order.isPending || reopen.isPending}
        onChange={setOrderIds} onCancel={() => { setOrderIds(null); order.reset(); }}
        onSave={() => order.mutate(orderIds, { onSuccess: restoreCursor })}
        onReload={order.isError ? () => reopen.mutate(deck.deck_id, { onSuccess: restoreCursor }) : undefined} />}
      {runtime.error && <p role="alert" className="mt-3 text-sm text-destructive">{runtime.error}</p>}
      {exportError && <p role="alert" className="mt-3 text-sm text-destructive">{exportError}</p>}
      {error && !(editing && edit.error) && <p role="alert" className="mt-3 border-l-2 border-primary pl-3 text-sm font-medium">{error.message}</p>}
      <DialogContent showCloseButton={!edit.isPending}>
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">Edit slide</DialogTitle>
          <DialogDescription>Slide {index + 1} · Revision {deck.revision}</DialogDescription>
        </DialogHeader>
        <form className="deck-edit" onSubmit={event => {
          event.preventDefault();
          edit.mutate({ command_id: crypto.randomUUID(), base_revision: deck.revision, slide_id: slide.slide_id,
            changes: { title: title.trim(), highlights, narration: notes.trim() } },
          { onSuccess: () => setEditing(false) });
        }}>
          <label>Slide title<Input required maxLength={160} value={title} onChange={e => setTitle(e.target.value)} /></label>
          <label>Highlights (1–4 lines, up to 240 characters each)<Textarea rows={3} value={points} onChange={e => setPoints(e.target.value)} /></label>
          <label>Speaker notes<Textarea required maxLength={12000} rows={3} value={notes} onChange={e => setNotes(e.target.value)} /></label>
          {edit.error && <p role="alert" className="text-sm text-destructive">{edit.error.message}</p>}
          <DialogFooter>
            <Button variant="outline" type="button" disabled={edit.isPending} onClick={() => setEditing(false)}>Cancel</Button>
            <Button type="submit" disabled={edit.isPending || !validChanges}>Review changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
      {proposal && <SlideDiff proposal={proposal} pending={decision.isPending} onDecision={choice => decision.mutate(choice)} />}
    </section>
    </Dialog>
  );
};
