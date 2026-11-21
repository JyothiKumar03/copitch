"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TSlideCountPromptProps } from "@/types/deck";
import { MAX_PRESENTATION_SLIDES } from "../../../shared/presentation";

export const SlideCountPrompt = ({ initialCount, pending, onPrepare }: TSlideCountPromptProps) => {
  const inputId = useId();
  const [count, setCount] = useState(initialCount?.toString() ?? "");
  const slideCount = Number(count);
  const canGenerate = !pending && Number.isInteger(slideCount) && slideCount >= 1 && slideCount <= MAX_PRESENTATION_SLIDES;
  const generate = () => { if (canGenerate) onPrepare({ slide_count: slideCount }); };
  return (
    <div className="grid gap-2" aria-busy={pending}>
      <label htmlFor={inputId} className="text-sm font-semibold">How many slides?</label>
      <div className="flex flex-wrap items-center gap-2">
        <Input id={inputId} type="number" inputMode="numeric" className="w-22 tabular-nums" min={1} max={MAX_PRESENTATION_SLIDES} step={1}
          disabled={pending} placeholder={`1–${MAX_PRESENTATION_SLIDES}`} value={count} onChange={event => setCount(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); generate(); } }} />
        <Button type="button" disabled={!canGenerate} onClick={generate}>{pending ? "Generating slides…" : "Generate slides"}</Button>
      </div>
    </div>
  );
};
