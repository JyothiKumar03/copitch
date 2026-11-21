"use client";

import { useState } from "react";
import { Check, Copy, Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePitchArtifact } from "@/hooks/research/use-pitch-artifact";
import { usePitchContent } from "@/hooks/research/use-pitch-content";
import { downloadPitchMarkdown } from "@/lib/pitch-artifact";
import type { TPitchContentProps } from "@/types/pitch-content";
import { PitchDocument } from "./PitchDocument";

export const PitchArtifact = (props: TPitchContentProps) => {
  const artifact = usePitchArtifact(props);
  const pitch = usePitchContent(props);
  const [sourceView, setSourceView] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  if (artifact.isPending) return <p role="status" className="p-4 text-sm text-muted-foreground">Opening pitch.md…</p>;
  if (artifact.isError) return <div role="alert" className="flex items-center gap-3 p-4 text-sm text-destructive">{artifact.error.message}
    <Button variant="outline" size="sm" onClick={() => void artifact.refetch()}>Retry</Button>
  </div>;
  const markdown = artifact.data;
  const copyPitch = async () => {
    if (!pitch.data) return;
    try {
      const text = [pitch.data.title, ...pitch.data.passages.map(item => item.text)].join("\n\n");
      await navigator.clipboard.writeText(text);
      setCopyStatus("copied");
    } catch { setCopyStatus("failed"); }
  };

  return (
    <article aria-label="Pitch document" className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/35 px-4 py-3 sm:px-5">
        <h2 className="flex items-center gap-2 text-base font-semibold"><FileText size={18} aria-hidden="true" className="text-primary" />pitch.md</h2>
        <Button variant="outline" size="sm" onClick={() => downloadPitchMarkdown(markdown)}><Download size={15} aria-hidden="true" />Download pitch.md</Button>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border/70 px-4 py-1.5 sm:px-5">
        <div role="group" aria-label="Document view" className="flex gap-1">
          {(["Preview", "Markdown"] as const).map(view => (
            <button key={view} type="button" aria-pressed={sourceView === (view === "Markdown")} onClick={() => setSourceView(view === "Markdown")}
              className="min-h-9 rounded px-2.5 text-sm text-muted-foreground aria-pressed:bg-muted aria-pressed:font-semibold aria-pressed:text-foreground">{view}</button>
          ))}
        </div>
        {pitch.data?.passages.length ? <Button variant="ghost" size="sm" onClick={copyPitch}>{copyStatus === "copied" ? <Check size={14} /> : <Copy size={14} />} {copyStatus === "copied" ? "Copied" : "Copy pitch"}</Button> : null}
      </div>
      {copyStatus === "failed" && <p role="status" className="px-4 pt-3 text-sm text-muted-foreground">Clipboard access is unavailable. You can select and copy the text.</p>}
      <div className="min-w-0 p-4 sm:p-6">
        {sourceView ? <pre aria-label="Markdown source" className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-6">{markdown}</pre> : <PitchDocument markdown={markdown} />}
      </div>
    </article>
  );
};
