import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { TSlideOrderProps } from "@/types/deck";

export const SlideOrder = ({ deck, ids, pending, onChange, onCancel, onSave, onReload }: TSlideOrderProps) => {
  const move = (index: number, offset: number) => {
    const next = [...ids];
    next.splice(index + offset, 0, ...next.splice(index, 1));
    onChange(next);
  };
  const changed = ids.some((id, index) => id !== deck.slides[index].slide_id);
  return (
    <section aria-label="Private slide order"><Card className="shadow-none">
      <CardHeader><h3 className="font-display text-2xl leading-tight">Review slide order</h3></CardHeader>
      <CardContent className="grid gap-4"><ol className="divide-y divide-border rounded-md border border-border">
        {ids.map((id, index) => {
          const current = deck.slides.findIndex(slide => slide.slide_id === id);
          const title = deck.slides[current].title;
          return <li key={id} className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div className="min-w-0 flex-1 break-words"><strong>{index + 1}. </strong>{title}
              {index !== current && <small className="block text-muted-foreground">Previously slide {current + 1}</small>}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={pending || index === 0} aria-label={"Move " + title + " earlier"} onClick={() => move(index, -1)}>Earlier</Button>
              <Button size="sm" variant="outline" disabled={pending || index === ids.length - 1} aria-label={"Move " + title + " later"} onClick={() => move(index, 1)}>Later</Button>
            </div>
          </li>;
        })}
      </ol>
      <div className="deck-tools">
        <Button disabled={pending || !changed} onClick={onSave}>{pending ? "Saving…" : "Save order"}</Button>
        <Button variant="outline" disabled={pending} onClick={onCancel}>Cancel</Button>
        {onReload && <Button variant="outline" disabled={pending} onClick={onReload}>Reload latest revision</Button>}
      </div>
      </CardContent></Card></section>
  );
};
