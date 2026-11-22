"use client";

import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowLeft, ArrowRight, AudioLines, Check, CircleAlert, ListOrdered, LoaderCircle, PencilLine, Play, Presentation, SlidersHorizontal } from "lucide-react";
import { usePresentation } from "@/hooks/deck/use-presentation";
import { useDeck } from "@/hooks/deck/use-deck";
import { exportDeck } from "@/lib/export-deck";
import { slideSources } from "@/lib/slide-source";
import type { TPreparationProgress } from "@/lib/decks";
import { fetchRecoveryDraft } from "@/lib/decks";
import type { TDeckWorkspaceProps, TPitchRequest } from "@/types/deck";
import { SlideCountPrompt } from "./SlideCountPrompt";
import { SlideOrder } from "./SlideOrder";
import { deckSlideView, PublicSlide, Slide } from "./Slide";
import { SlideDiff } from "./SlideDiff";
import { LiveDeck } from "./LiveDeck";
import { RecoveryDraft } from "./RecoveryDraft";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { MAX_PRESENTATION_SLIDES } from "../../../shared/presentation";
import type { TDeckPreparationFailure } from "../../../shared/presentation";
import "./stage.css";

const phaseText: Record<TPreparationProgress, string> = {
  queued: "Slide preparation queued",
  checking_evidence: "Checking the evidence against your slide count",
  researching_gaps: "Looking for evidence to fill coverage gaps",
  planning_slides: "Writing slides and narration",
  reviewing_slides: "Checking the rendered slides",
  running: "Preparing your presentation",
};

const PreparationStatus = ({ progress, count }: { progress: TPreparationProgress; count?: number }) => (
  <p role="status" className="flex items-center gap-2.5 rounded-md border border-primary/25 bg-primary/7 px-3 py-2.5 text-sm text-foreground">
    <LoaderCircle size={17} aria-hidden="true" className="shrink-0 animate-spin text-primary motion-reduce:animate-none" />
    <span>{phaseText[progress]}{count !== undefined ? ` · ${count} ${count === 1 ? "slide" : "slides"}` : ""}</span>
  </p>
);

const PreparationNotice = ({ message }: { message: string }) => (
  <div role="alert" className="flex min-w-0 items-start gap-2.5 rounded-md border border-destructive/25 bg-destructive/8 px-3 py-2.5 text-sm text-destructive">
    <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
    <div className="min-w-0 wrap-anywhere"><p className="font-semibold">Couldn’t prepare slides</p>{message}</div>
  </div>
);

const PreparationRecovery = ({ info, busy, canAdd, onMake, onAdd, onDraft }: { info: TDeckPreparationFailure; busy: boolean;
  canAdd: boolean; onMake: (count: number) => void; onAdd: () => void; onDraft: (id: string) => void }) => {
  const needsContent = info.reason_code === "insufficient_evidence" || info.reason_code === "grounding_failed";
  const canReduce = info.supported_slide_count > 0 && (info.requested_slide_count === undefined || info.supported_slide_count < info.requested_slide_count);
  const retryCount = !needsContent ? info.requested_slide_count : undefined;
  return <section className="grid min-w-0 gap-3 rounded-lg border border-border bg-card p-3 text-sm" aria-label="Slide preparation recovery">
      <div role="alert" className="wrap-anywhere">
        <p className="flex items-center gap-2 font-semibold"><CircleAlert size={16} aria-hidden="true" className="text-primary" />Couldn’t prepare all slides</p>
        <p className="mt-1 text-muted-foreground">{info.message}</p>
      </div>
      {info.gaps.length > 0 && <ul className="list-disc space-y-1 pl-5 text-muted-foreground">{info.gaps.map(gap => <li key={gap}>{gap}</li>)}</ul>}
      <div className="flex flex-wrap gap-2">
        {canReduce && <Button size="sm" disabled={busy} onClick={() => onMake(info.supported_slide_count)}>
          Make {info.supported_slide_count} {info.supported_slide_count === 1 ? "slide" : "slides"} now
        </Button>}
        {retryCount !== undefined && <Button size="sm" variant={canReduce ? "outline" : "default"} disabled={busy} onClick={() => onMake(retryCount)}>
          Retry {retryCount} {retryCount === 1 ? "slide" : "slides"}
        </Button>}
        {canAdd && needsContent && <Button size="sm" variant="outline" disabled={busy} onClick={onAdd}>Add content</Button>}
        {info.partial_deck_id && <Button size="sm" variant="outline" disabled={busy} onClick={() => onDraft(info.partial_deck_id!)}>Edit draft myself</Button>}
      </div>
    </section>;
};

export const DeckWorkspace = (props: TDeckWorkspaceProps & { backToConversation: () => void; onPreviewReady: (researchId: string) => void;
  researchAction?: ReactNode; initialCount?: number; onAddContent?: (gaps: string[]) => void }) => {
  const { onPreviewReady, researchId } = props;
  const { order, deck, pitches, reopen, refresh, variantsError, proposal, prepare, preparationProgress, edit, decision, recovery } = useDeck(props);
  const draft = useMutation({ mutationFn: async (id: string) => fetchRecoveryDraft(await props.getSession(), id) });
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
  const wasLive = useRef(false);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const preparationPanel = useRef<HTMLDivElement>(null);
  const handledManualCommand = useRef<string | undefined>(undefined);
  const slide = deck?.slides[index];
  const runtime = usePresentation(deck, props.getSession, props.researchId);
  const { mutate: refreshDeck } = refresh;
  const deckId = deck?.deck_id;
  const refreshRevision = useCallback(() => { if (deckId) refreshDeck(deckId); }, [deckId, refreshDeck]);
  const beginEdit = useCallback(() => {
    if (!slide) return;
    setTitle(slide.title); setPoints(slide.highlights.join("\n")); setNotes(slide.narration); setEditing(true);
  }, [slide]);
  useEffect(() => { if (deckId) onPreviewReady(researchId); }, [deckId, onPreviewReady, researchId]);
  const command = props.command;
  useEffect(() => {
    if (!command?.manual || handledManualCommand.current === command.turn_id || runtime.active || command.research_id !== researchId) return;
    if (command.deck_id && (deckId !== command.deck_id || command.deck_revision !== undefined && deck?.revision !== command.deck_revision)) return;
    const frame = requestAnimationFrame(() => {
      handledManualCommand.current = command.turn_id;
      if (slide) beginEdit();
      else preparationPanel.current?.querySelector("input")?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [beginEdit, command, deck?.revision, deckId, researchId, runtime.active, slide]);
  useEffect(() => {
    const returnedFromLive = wasLive.current && !runtime.active;
    wasLive.current = runtime.active;
    const heading = previewHeading.current;
    if (!heading || (!returnedFromLive && previewFocusRequest === lastPreviewFocus.current)) return;
    lastPreviewFocus.current = previewFocusRequest;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ block: "start", behavior: "instant" });
  }, [deck, previewFocusRequest, runtime.active]);
  const error = order.error ?? reopen.error ?? refresh.error ?? decision.error ?? edit.error ?? prepare.error ?? variantsError;
  const navigate = (direction: number) => setIndex(i => Math.max(0, Math.min((deck?.slides.length ?? 1) - 1, i + direction)));
  const resetPreview = () => {
    setOrderIds(null); order.reset(); setIndex(0); setEditing(false); setPreparingVariant(false);
    edit.reset(); decision.reset(); requestPreviewFocus();
  };
  const preparePitch = (pitch: TPitchRequest) => prepare.mutate(pitch, { onSuccess: resetPreview });
  const busy = !!orderIds || order.isPending || prepare.isPending || reopen.isPending || runtime.pending || editing || !!proposal || decision.isPending;
  const pitchPicker = pitches.length > (deck ? 1 : 0) && (
    <label className="grid min-w-0 gap-1.5 text-sm font-medium">Prepared presentations
      <NativeSelect className="w-full min-w-0" value={deck?.deck_id ?? ""} disabled={busy} onChange={event => reopen.mutate(event.target.value, { onSuccess: resetPreview })}>
        {!deck && <NativeSelectOption value="" disabled>Choose a saved presentation</NativeSelectOption>}
        {pitches.map(pitch => <NativeSelectOption key={pitch.deck_id} value={pitch.deck_id}>{pitch.label}</NativeSelectOption>)}
      </NativeSelect>
    </label>
  );

  if (deck && runtime.active) return <LiveDeck deck={deck} runtime={runtime} refreshRevision={refreshRevision}
    backToConversation={props.backToConversation} />;
  const requestedCount = prepare.variables?.slide_count ?? recovery?.requested_slide_count;
  const preparationStatus = prepare.isPending && <PreparationStatus progress={preparationProgress} count={requestedCount} />;
  const recoveryCard = recovery && <PreparationRecovery info={recovery} busy={busy || draft.isPending} canAdd={!!props.onAddContent}
    onMake={slide_count => preparePitch({ slide_count })} onAdd={() => props.onAddContent?.(recovery.gaps)} onDraft={draft.mutate} />;
  const draftDialog = draft.data && <RecoveryDraft key={draft.data.draft_id} initial={draft.data} getSession={props.getSession} close={draft.reset} />;
  if (!deck || !slide) return (
    <Card className="grid min-w-0 gap-4 bg-background p-4 sm:p-5" aria-label="Presentation preparation">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2"><Presentation size={17} aria-hidden="true" className="text-primary" /><h3 className="font-semibold">Research is ready</h3></div>
        {props.researchAction}
      </div>
      <div ref={preparationPanel}>
        <SlideCountPrompt pending={busy} initialCount={requestedCount ?? props.initialCount ?? command?.slide_count} onPrepare={preparePitch} />
      </div>
      {preparationStatus}
      {recoveryCard}
      {error && !(recovery && error === prepare.error) && (prepare.error ? <PreparationNotice message={error.message} /> : <p role="alert" className="text-sm text-destructive">{error.message}</p>)}
      {draft.error && <p role="alert" className="text-sm text-destructive">{draft.error.message}</p>}
      {draftDialog}
      {pitchPicker}
    </Card>
  );
  const highlights = points.split("\n").map(point => point.trim()).filter(Boolean);
  const highlightsChanged = highlights.length !== slide.highlights.length || highlights.some((point, i) => point !== slide.highlights[i]);
  const validChanges = !!title.trim() && !!notes.trim() && highlights.length <= 4 &&
    highlights.every(point => point.length <= 240) && (!highlightsChanged || highlights.length > 0) &&
    (title.trim() !== slide.title || notes.trim() !== slide.narration || highlightsChanged);
  const restoreCursor = (next: typeof deck) => {
    const nextIndex = next.slides.findIndex(item => item.slide_id === slide.slide_id);
    setIndex(Math.max(0, nextIndex)); setOrderIds(null); order.reset();
  };
  const locked = busy;
  const seconds = deck.pitch?.estimated_seconds;
  const duration = seconds ? [Math.floor(seconds / 60) > 0 ? `${Math.floor(seconds / 60)} min` : "", `${seconds % 60} sec`].filter(Boolean).join(" ") : undefined;
  return (
    <Dialog open={editing && !proposal} onOpenChange={open => { if (!open && !edit.isPending) setEditing(false); }}>
    <section className="deck-workspace text-foreground">
      <div className="deck-review-header mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 ref={previewHeading} tabIndex={-1} className="scroll-mt-4 text-2xl font-semibold tracking-[-.045em] sm:text-[1.85rem]">Presentation preview</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>{deck.slides.length} {deck.slides.length === 1 ? "slide" : "slides"} · Revision {deck.revision}</span>
            {duration && <span className="inline-flex items-center gap-1"><AudioLines size={13} aria-hidden="true" />{duration} narration</span>}
            {deck.render_review?.status === "passed" && <span className="inline-flex items-center gap-1 text-evidence"><Check size={13} aria-hidden="true" />Layout checked</span>}
          </div>
        </div>
        <Button className="min-h-11" disabled={locked} onClick={() => void runtime.enter()}><Play size={16} aria-hidden="true" />{runtime.pending ? "Opening…" : runtime.state?.revision === deck.revision ? "Open live controls" : "Approve and present"}</Button>
      </div>
      {!deck.grounding_mode && <p role="status" className="mb-3 rounded-md border-l-2 border-evidence bg-card px-3 py-2 text-sm">This saved deck predates evidence review. Refine the brief and run research again for checked findings.</p>}
      <div className="deck-review-grid">
        <nav className="deck-filmstrip" aria-label="Slide thumbnails">
          <ol>{deck.slides.map((item, itemIndex) => <li key={item.slide_id} className="slide-choice" data-current={itemIndex === index}>
            <div className="slide-choice-preview" aria-hidden="true"><PublicSlide view={deckSlideView(deck, item, itemIndex)} /></div>
            <span aria-hidden="true" className="flex min-w-0 items-center gap-1.5 text-xs"><span className="font-mono tabular-nums text-primary">{String(itemIndex + 1).padStart(2, "0")}</span><span className="truncate">{item.title}</span></span>
            <Button type="button" variant="ghost" className="slide-choice-trigger" aria-current={itemIndex === index ? "step" : undefined}
              aria-label={`Review slide ${itemIndex + 1}: ${item.title}`} disabled={locked} onClick={() => setIndex(itemIndex)} />
          </li>)}</ol>
        </nav>
        <div className="min-w-0">
          <div className="deck-canvas"><Slide deck={deck} slide={slide} index={index} /></div>
          <div className="deck-action-row mt-3" aria-label="Presentation controls">
            <div className="deck-tools">
              <Button variant="outline" size="sm" disabled={locked || index === 0} onClick={() => navigate(-1)}><ArrowLeft size={15} aria-hidden="true" />Previous</Button>
              <Button variant="outline" size="sm" disabled={locked || index === deck.slides.length - 1} onClick={() => navigate(1)}>Next<ArrowRight size={15} aria-hidden="true" /></Button>
            </div>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">{index + 1} / {deck.slides.length}</span>
          </div>
          <div className="deck-tools mt-3 border-t border-border pt-2" aria-label="Slide editing and export">
            <DialogTrigger asChild><Button size="sm" variant="ghost" disabled={locked} onClick={beginEdit}><PencilLine size={15} aria-hidden="true" />Edit slide</Button></DialogTrigger>
            <Button size="sm" variant="ghost" disabled={locked || deck.slides.length < 2} onClick={() => { order.reset(); setPreparingVariant(false); setOrderIds(deck.slides.map(item => item.slide_id)); }}><ListOrdered size={15} aria-hidden="true" />Reorder slides</Button>
            <Button size="sm" variant="ghost" onClick={() => {
              setExportError(null);
              void exportDeck(deck).catch(() => setExportError("The offline presentation could not be downloaded. Try again."));
            }}><ArrowDownToLine size={15} aria-hidden="true" />Download offline slides</Button>
          </div>
        </div>
        <aside className="deck-review-inspector grid min-w-0 content-start gap-3" aria-label="Private slide inspector">
          <Card>
            <CardHeader className="flex flex-row items-center gap-2 px-4 pt-4">
              <AudioLines size={16} className="text-primary" aria-hidden="true" />
              <h3 className="text-sm font-semibold">Private narration</h3>
            </CardHeader>
            <CardContent className="pitch-notes p-4 pt-3">
              <p>{slide.narration}</p>
              {!!slide.evidence_ids.length && <div className="mt-4 border-t border-border pt-3">
                <h4 className="mb-2 text-xs font-semibold text-evidence">Slide sources</h4>
                <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Slide sources">{slideSources(deck, slide.evidence_ids).map(source => {
                  return <li className="min-w-0 wrap-anywhere" key={source.label}>{source.href ? <a href={source.href} target="_blank" rel="noreferrer" className="text-evidence underline underline-offset-2">{source.label}</a> : source.label}</li>;
                })}</ul>
              </div>}
            </CardContent>
          </Card>
          <Card><CardContent className="grid gap-3 p-4">
            {props.researchAction}
            {pitchPicker}
            {deck.pitch?.slide_count !== undefined && deck.pitch.slide_count !== deck.slides.length &&
              <p role="status" className="text-sm text-evidence">This saved deck has {deck.slides.length} of {deck.pitch.slide_count} requested slides. Generate the requested count again to check available evidence.</p>}
            {deck.pitch?.readiness?.status === "limited" && deck.pitch.readiness.reason &&
              <p className="text-sm text-muted-foreground">{deck.pitch.readiness.reason}</p>}
            {deck.pitch?.readiness?.status === "limited" && deck.pitch.readiness.gaps.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {deck.pitch.readiness.gaps.map(gap => <li key={gap}>{gap}</li>)}
            </ul>}
            <Collapsible open={preparingVariant} onOpenChange={setPreparingVariant}>
              <CollapsibleTrigger asChild>
                <Button size="sm" variant="outline" type="button" disabled={locked}><SlidersHorizontal size={15} aria-hidden="true" />{preparingVariant ? "Close slide count" : "Change slide count"}</Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3">
                <SlideCountPrompt key={deck.deck_id} initialCount={Math.min(requestedCount ?? deck.pitch?.slide_count ?? deck.slides.length, MAX_PRESENTATION_SLIDES)} pending={locked} onPrepare={preparePitch} />
              </CollapsibleContent>
            </Collapsible>
            {preparationStatus}
            {recoveryCard}
            {prepare.error && !recovery && <PreparationNotice message={prepare.error.message} />}
            {draft.error && <p role="alert" className="text-sm text-destructive">{draft.error.message}</p>}
          </CardContent></Card>
        </aside>
      </div>
      {orderIds && <SlideOrder deck={deck} ids={orderIds} pending={order.isPending || reopen.isPending}
        onChange={setOrderIds} onCancel={() => { setOrderIds(null); order.reset(); }}
        onSave={() => order.mutate(orderIds, { onSuccess: restoreCursor })}
        onReload={order.isError ? () => reopen.mutate(deck.deck_id, { onSuccess: restoreCursor }) : undefined} />}
      {runtime.error && <p role="alert" className="mt-3 text-sm text-destructive">{runtime.error}</p>}
      {exportError && <p role="alert" className="mt-3 text-sm text-destructive">{exportError}</p>}
      {error && error !== prepare.error && !(editing && edit.error) && <p role="alert" className="mt-3 border-l-2 border-primary pl-3 text-sm font-medium">{error.message}</p>}
      <DialogContent showCloseButton={!edit.isPending}>
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">Edit slide</DialogTitle>
          <DialogDescription>Slide {index + 1} · Revision {deck.revision}</DialogDescription>
        </DialogHeader>
        <form className="deck-edit" onSubmit={event => {
          event.preventDefault();
          edit.mutate({ command_id: crypto.randomUUID(), base_revision: deck.revision, slide_id: slide.slide_id,
            changes: { title: title.trim(), ...(highlightsChanged && { highlights }), narration: notes.trim() } },
          { onSuccess: () => setEditing(false) });
        }}>
          <label>Slide title<Input required maxLength={160} value={title} onChange={e => setTitle(e.target.value)} /></label>
          <label>Highlights (up to 4 lines, 240 characters each)<Textarea rows={3} value={points} onChange={e => setPoints(e.target.value)} /></label>
          <label>Speaker notes<Textarea required maxLength={12000} rows={3} value={notes} onChange={e => setNotes(e.target.value)} /></label>
          {edit.error && <p role="alert" className="text-sm text-destructive">{edit.error.message}</p>}
          <DialogFooter>
            <Button variant="outline" type="button" disabled={edit.isPending} onClick={() => setEditing(false)}>Cancel</Button>
            <Button type="submit" disabled={edit.isPending || !validChanges}>Review changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
      {proposal && <SlideDiff proposal={proposal} pending={decision.isPending} onDecision={choice => decision.mutate(choice)} />}
      {draftDialog}
    </section>
    </Dialog>
  );
};
