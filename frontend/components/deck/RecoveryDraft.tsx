"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveRecoveryDraft } from "@/lib/decks";
import type { TDeckWorkspaceProps } from "@/types/deck";
import type { TDeckRecoveryDraft, TDeckRecoverySlide } from "../../../shared/presentation";

const DraftSlide = ({ index, slide, pending, save }: { index: number; slide: TDeckRecoverySlide; pending: boolean;
  save: (text: Pick<TDeckRecoverySlide, "title" | "narration" | "highlights">) => void }) => {
  const [title, setTitle] = useState(slide.title);
  const [notes, setNotes] = useState(slide.narration);
  const [points, setPoints] = useState(slide.highlights.join("\n"));
  const highlights = points.split("\n").map(text => text.trim()).filter(Boolean);
  const invalid = highlights.length > 4 || highlights.some(text => text.length > 240);
  return <form className="grid min-w-0 gap-3" onSubmit={event => {
    event.preventDefault();
    if (!invalid) save({ title, highlights, narration: notes });
  }}>
    <h3 className="text-sm font-semibold">Slide {index + 1} · {slide.status === "verified" ? "Evidence checked" : slide.status === "edited" ? "Edited draft" : "Blank slide"}</h3>
    <label className="grid gap-1 text-sm">Slide title<Input value={title} maxLength={160} onChange={event => setTitle(event.target.value)} /></label>
    <label className="grid gap-1 text-sm">Highlights<Textarea value={points} rows={3} onChange={event => setPoints(event.target.value)} /></label>
    <label className="grid gap-1 text-sm">Speaker notes<Textarea value={notes} rows={3} maxLength={12000} onChange={event => setNotes(event.target.value)} /></label>
    {invalid && <p role="alert" className="text-sm text-destructive">Use up to four highlights of 240 characters each.</p>}
    <Button type="submit" className="justify-self-start" disabled={pending || invalid}>{pending ? "Saving…" : "Save draft slide"}</Button>
  </form>;
};

export const RecoveryDraft = ({ initial, getSession, close }: { initial: TDeckRecoveryDraft;
  getSession: TDeckWorkspaceProps["getSession"]; close: () => void }) => {
  const [draft, setDraft] = useState(initial);
  const [index, setIndex] = useState(0);
  const slide = draft.slides[index];
  const update = useMutation({
    mutationFn: async (text: Pick<TDeckRecoverySlide, "title" | "narration" | "highlights">) =>
      saveRecoveryDraft(await getSession(), draft, slide.slide_id, text),
    onSuccess: setDraft,
  });
  return <Dialog open onOpenChange={open => { if (!open && !update.isPending) close(); }}>
    <DialogContent className="max-h-[90dvh] max-w-2xl min-w-0 overflow-y-auto" showCloseButton={!update.isPending}>
      <DialogTitle className="font-display text-2xl font-normal">Private draft</DialogTitle>
      <DialogDescription>Revision {draft.revision} · {draft.requested_slide_count} slides. Review checked slides and fill in missing content.</DialogDescription>
      <nav aria-label="Draft slides" className="flex flex-wrap gap-1.5">
        {draft.slides.map((item, position) => <Button key={item.slide_id} size="sm" variant={position === index ? "secondary" : "outline"}
          aria-label={`Draft slide ${position + 1}${item.status === "blank" ? ", blank" : ""}`} aria-current={position === index ? "step" : undefined}
          disabled={update.isPending} onClick={() => { update.reset(); setIndex(position); }}>{position + 1}</Button>)}
      </nav>
      <DraftSlide key={`${slide.slide_id}:${draft.revision}`} index={index} slide={slide} pending={update.isPending} save={update.mutate} />
      {update.error && <p role="alert" className="text-sm text-destructive">{update.error.message}</p>}
      {update.isSuccess && <p role="status" className="text-sm text-evidence">Draft saved</p>}
    </DialogContent>
  </Dialog>;
};
