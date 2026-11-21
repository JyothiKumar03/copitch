"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { usePitchContent } from "@/hooks/research/use-pitch-content";
import type { TPitchContentProps } from "@/types/pitch-content";

export const PitchContent = (props: TPitchContentProps) => {
  const result = usePitchContent(props);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  if (result.isPending) return <p role="status">Opening your pitch…</p>;
  if (result.isError) return <p role="alert" className="space-x-3 text-destructive">{result.error.message} <Button variant="outline" onClick={() => void result.refetch()}>Try again</Button></p>;
  const { title, format, passages, sources } = result.data;
  if (!passages.length) return <section><h2 className="font-display text-4xl">Your pitch</h2>
    <p className="mt-3 text-muted-foreground">There are no reviewed talking points yet. Add supporting material or refine the research scope.</p></section>;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText([title, ...passages.map(passage => passage.text)].join("\n\n"));
      setCopyState("copied");
    } catch { setCopyState("failed"); }
  };
  return <article aria-label="Prepared pitch" className="border border-border bg-card">
    <header className="space-y-4 border-b border-border p-6 sm:p-9">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm font-semibold text-muted-foreground">{format === "script" ? "Your pitch script" : "Your talking points"}</p>
        <Button variant="outline" onClick={() => void copy()}>{copyState === "copied" ? "Copied" : "Copy pitch"}</Button>
      </div>
      <h2 className="max-w-[26ch] break-words font-display text-4xl font-normal leading-[1.06] tracking-tight sm:text-5xl">{title}</h2>
    </header>
    {copyState === "failed" && <p role="status" className="px-6 pt-4 text-sm text-destructive">Clipboard access is unavailable. Select the pitch text to copy it.</p>}
    <div className="divide-y divide-border px-6 sm:px-9">
      {passages.map((passage, index) => <section key={index} className="grid gap-3 py-6 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-8">
        <h3 className="font-display text-2xl font-normal leading-tight text-primary">{passage.label}</h3>
        <div><p className="max-w-prose whitespace-pre-wrap break-words text-base leading-7">{passage.text}</p>
          {!!passage.evidence_ids.length && <p className="mt-2 text-xs text-muted-foreground">Sources {passage.evidence_ids.join(", ")}</p>}
        </div>
      </section>)}
    </div>
    {!!sources.length && <details className="border-t border-border bg-muted/40 px-6 py-4 sm:px-9"><summary className="cursor-pointer text-sm font-semibold">Source references ({sources.length})</summary>
      <ul className="mt-3 space-y-2 text-sm text-muted-foreground">{sources.map(source => <li key={source.id}>{source.id} · {source.url && /^https?:\/\//i.test(source.url)
        ? <a href={source.url} target="_blank" rel="noreferrer" className="break-words text-primary underline underline-offset-4">{source.location}</a> : source.location}</li>)}</ul>
    </details>}
  </article>;
};
