"use client";

import Image from "next/image";
import { useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowRight } from "lucide-react";
import { planWalkthroughSelection } from "../../../shared/walkthrough-selection";
import type {
  TWalkthroughSelectionCatalog, TWalkthroughSelectionExport, TWalkthroughSelectionInput, TWalkthroughSelectionItem, TWalkthroughSelectionSlide,
} from "../../../shared/walkthrough-selection";
import type { TWalkthroughSelectionSource } from "@/lib/walkthrough-selection";
import { downloadWalkthroughSelection, readWalkthroughSelections, saveWalkthroughSelection } from "@/lib/walkthrough-selection";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

type TPanelProps = {
  projectId: string;
  source: TWalkthroughSelectionSource;
  imageUrl: (pageNumber: number) => string;
  downloadArchived: () => Promise<void>;
};

type TSelectionGroup = { pageNumber: number; items: TWalkthroughSelectionItem[] };
type TSelectionReview = { input: TWalkthroughSelectionInput; slides: TWalkthroughSelectionSlide[] };

const kindLabel: Record<TWalkthroughSelectionItem["kind"], string> = {
  title: "Title", caption: "Caption", fact: "Fact", url: "URL", screenshot: "Screenshot",
};
const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const groupItems = (items: TWalkthroughSelectionItem[]) => {
  const groups: TSelectionGroup[] = [];
  for (const item of items) {
    const current = groups.at(-1);
    if (current?.pageNumber === item.page_number) current.items.push(item);
    else groups.push({ pageNumber: item.page_number, items: [item] });
  }
  return groups;
};
const selectionKey = (projectId: string, source: TWalkthroughSelectionSource) =>
  ["walkthrough-powerpoint-selections", projectId, source.kind, source.captureId];

const SelectionPreview = ({ slides, sourceLabel, imageUrl }: {
  slides: TWalkthroughSelectionSlide[];
  sourceLabel: string;
  imageUrl: TPanelProps["imageUrl"];
}) => <ol className="grid min-w-0 gap-3" aria-label="PowerPoint slides">
  {slides.map((slide, index) => <li key={index} className="min-w-0 rounded-md border border-border px-4 py-3">
    <p className="text-sm font-semibold">Slide {index + 1} <span className="font-normal text-muted-foreground">
      · {slide.kind === "source" ? `${sourceLabel} ${slide.page_number}` : "Your text"}
    </span></p>
    {slide.kind === "source" ?
      <ul className="mt-3 grid min-w-0 gap-3">
        {slide.items.map((item, itemIndex) => <li key={`${item.item_id}-${itemIndex}`} className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{kindLabel[item.kind]}</p>
          {item.kind === "screenshot" ?
            <Image unoptimized alt={`Screenshot of saved ${sourceLabel.toLowerCase()} ${slide.page_number}`} src={imageUrl(slide.page_number)} width={1440} height={900}
              className="mt-1.5 aspect-[8/5] h-auto w-full max-w-xl rounded-sm bg-muted object-contain" /> :
            <p className="mt-0.5 whitespace-pre-wrap wrap-anywhere text-sm">{item.text}</p>}
        </li>)}
      </ul> :
      <p className="mt-2 whitespace-pre-wrap wrap-anywhere text-sm">{slide.host_text}</p>}
  </li>)}
</ol>;

const SelectionForm = ({ projectId, source, imageUrl, downloadArchived, catalog }: TPanelProps & { catalog: TWalkthroughSelectionCatalog }) => {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [text, setText] = useState("");
  const [review, setReview] = useState<TSelectionReview | null>(null);
  const titleId = useId();
  const reviewTitle = useRef<HTMLHeadingElement>(null);
  const selectionTitle = useRef<HTMLHeadingElement>(null);
  const savedTitle = useRef<HTMLHeadingElement>(null);
  const queryClient = useQueryClient();
  const sourceLabel = source.kind === "site-runs" ? "Step" : "Page";
  const chosen = catalog.items.filter(item => selected.has(item.item_id));
  const additions = text.trim() ? [text] : [];
  const download = useMutation({ mutationFn: (saved: TWalkthroughSelectionExport) => downloadWalkthroughSelection(projectId, source, saved) });
  const archive = useMutation({ mutationFn: downloadArchived });
  const save = useMutation({
    mutationFn: (input: TWalkthroughSelectionInput) => saveWalkthroughSelection(projectId, source, input),
    onSuccess: saved => {
      queryClient.setQueryData<TWalkthroughSelectionCatalog>(selectionKey(projectId, source), current => current && ({
        ...current, exports: [saved, ...current.exports.filter(entry => entry.export_id !== saved.export_id)],
      }));
      setSelected(new Set());
      setText("");
      setReview(null);
      download.mutate(saved);
      requestAnimationFrame(() => savedTitle.current?.focus());
    },
  });
  const busy = save.isPending || download.isPending;
  const toggle = (id: string, include: boolean) => setSelected(previous => {
    const next = new Set(previous);
    if (include) next.add(id);
    else next.delete(id);
    return next;
  });
  const openReview = () => {
    save.reset();
    setReview({ slides: planWalkthroughSelection(chosen, additions), input: {
      request_id: crypto.randomUUID(), source_revision: catalog.source_revision,
      item_ids: chosen.map(item => item.item_id), host_additions: additions, approved: true,
    } });
    requestAnimationFrame(() => reviewTitle.current?.focus());
  };
  const editSelection = () => {
    setReview(null);
    save.reset();
    void queryClient.invalidateQueries({ queryKey: selectionKey(projectId, source) });
    requestAnimationFrame(() => selectionTitle.current?.focus());
  };
  return <Card role="region" aria-labelledby={titleId}>
    <CardHeader>
      <h3 id={titleId} ref={selectionTitle} tabIndex={-1} className="text-xl font-semibold tracking-tight">Choose PowerPoint content</h3>
      <p className="text-sm text-muted-foreground">Select the text and screenshots you want to include. A screenshot may show other text from the page.</p>
    </CardHeader>
    <CardContent className="grid min-w-0 gap-5">
      {review ? <section className="grid min-w-0 gap-4" aria-labelledby={`${titleId}-review`}>
        <h4 id={`${titleId}-review`} ref={reviewTitle} tabIndex={-1} className="text-base font-semibold">Review selected slides</h4>
        <SelectionPreview slides={review.slides} sourceLabel={sourceLabel} imageUrl={imageUrl} />
        {save.error && <p role="alert" className="text-sm text-destructive">{save.error.message}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy} onClick={() => save.mutate(review.input)}>
            <ArrowDownToLine size={16} aria-hidden="true" />{save.isPending ? "Saving PowerPoint…" : "Confirm and export PowerPoint"}
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={editSelection}>Edit selection</Button>
        </div>
      </section> : <>
        {groupItems(catalog.items).map(({ pageNumber, items }) => <fieldset key={pageNumber} className="min-w-0 rounded-md border border-border px-3 pb-3 sm:px-4">
          <legend className="px-1 text-sm font-semibold">{sourceLabel} {pageNumber}</legend>
          <div className="grid min-w-0">
            {items.map(item => <label key={item.item_id}
              className="flex min-w-0 cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-accent/40 has-checked:bg-accent/70">
              <input type="checkbox" checked={selected.has(item.item_id)} onChange={event => toggle(item.item_id, event.currentTarget.checked)}
                className="mt-1 size-4 shrink-0 cursor-pointer accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />
              <span className="grid min-w-0 gap-0.5">
                <span className="text-xs font-medium text-muted-foreground">{kindLabel[item.kind]}</span>
                <span className="whitespace-pre-wrap wrap-anywhere text-sm">{item.kind === "screenshot" ? "Full captured image" : item.text}</span>
              </span>
            </label>)}
          </div>
        </fieldset>)}
        <label className="grid min-w-0 gap-1.5 text-sm font-semibold">
          Your text <span className="text-xs font-normal text-muted-foreground">Optional. Your text appears on separate slides.</span>
          <Textarea value={text} onChange={event => setText(event.currentTarget.value)} maxLength={2000} rows={3} className="font-normal" />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled={busy || !chosen.length && !additions.length} onClick={openReview}>
            Review selection <ArrowRight size={16} aria-hidden="true" />
          </Button>
          <p role="status" className="text-sm text-muted-foreground">
            {chosen.length ? `${chosen.length} captured ${chosen.length === 1 ? "item" : "items"} selected` :
              additions.length ? "Your text is ready to review." : "Select an item or add your own text."}
          </p>
        </div>
      </>}
      {!!catalog.exports.length && <section className="grid min-w-0 gap-3 border-t border-border pt-4" aria-labelledby={`${titleId}-saved`}>
        <h4 id={`${titleId}-saved`} ref={savedTitle} tabIndex={-1} className="text-base font-semibold">Saved PowerPoint exports</h4>
        {save.data && <p role="status" className="text-sm text-muted-foreground">
          Revision {save.data.revision} saved. {download.isPending ? "Downloading…" : "It’s available to download again."}
        </p>}
        {download.error && <p role="alert" className="text-sm text-destructive">{download.error.message}</p>}
        <ul className="grid min-w-0 divide-y divide-border">
          {catalog.exports.map(entry => <li key={entry.export_id} className="grid min-w-0 gap-2 py-3">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">Revision {entry.revision} <span className="font-normal text-muted-foreground">· {date.format(entry.created_at)}</span></p>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => download.mutate(entry)}>
                <ArrowDownToLine size={15} aria-hidden="true" />Download selected PowerPoint
              </Button>
            </div>
            <details className="min-w-0 text-sm">
              <summary className="w-fit cursor-pointer rounded-sm text-evidence hover:underline">View saved selection</summary>
              <div className="mt-3">
                <SelectionPreview slides={entry.slides ?? planWalkthroughSelection(entry.items, entry.host_additions)} sourceLabel={sourceLabel} imageUrl={imageUrl} />
              </div>
            </details>
          </li>)}
        </ul>
      </section>}
      {catalog.has_archived_export && <div className="grid min-w-0 gap-2 border-t border-border pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold">Archived full walkthrough</h4>
            <p className="text-sm text-muted-foreground">The original PowerPoint covers the full capture.</p>
          </div>
          <Button type="button" variant="outline" size="sm" disabled={archive.isPending} onClick={() => archive.mutate()}>
            <ArrowDownToLine size={15} aria-hidden="true" />Download archived PowerPoint
          </Button>
        </div>
        {archive.error && <p role="alert" className="text-sm text-destructive">{archive.error.message}</p>}
      </div>}
    </CardContent>
  </Card>;
};

export const PowerPointSelection = (props: TPanelProps) => {
  const { projectId, source } = props;
  const query = useQuery({
    queryKey: selectionKey(projectId, source),
    queryFn: ({ signal }) => readWalkthroughSelections(projectId, source, signal),
    retry: false,
  });
  if (query.data) return <SelectionForm key={query.data.source_revision} {...props} catalog={query.data} />;
  return <Card>
    <CardContent className="flex flex-wrap items-center gap-2 text-sm">
      {query.error ? <>
        <p role="alert" className="text-destructive">{query.error.message}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>Reload PowerPoint content</Button>
      </> : <p role="status" className="text-muted-foreground">Opening PowerPoint content…</p>}
    </CardContent>
  </Card>;
};
