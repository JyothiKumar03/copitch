"use client";

import { useState } from "react";
import { Check, Copy, Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useContextArtifact } from "@/hooks/research/use-context-artifact";
import type { TContextArtifactProps } from "@/types/research";
import { PitchDocument } from "./PitchDocument";

export const ContextArtifact = (props: TContextArtifactProps) => {
  const { artifact, partial, download, retry } = useContextArtifact(props);
  const [sourceView, setSourceView] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const markdown = artifact.data?.markdown;
  const preview = artifact.data?.preview ?? partial;
  const copyContext = async () => {
    if (markdown === undefined) return;
    try { await navigator.clipboard.writeText(markdown); setCopyStatus("copied"); }
    catch { setCopyStatus("failed"); }
  };

  return <article aria-label="Context document" className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/35 px-4 py-3 sm:px-5">
      <h2 className="flex items-center gap-2 text-base font-semibold"><FileText size={18} aria-hidden="true" className="text-primary" />context.md</h2>
      <Button variant="outline" size="sm" disabled={markdown === undefined || download.isPending} onClick={() => download.mutate()}>
        <Download size={15} aria-hidden="true" />{download.isPending ? "Downloading…" : "Download context.md"}
      </Button>
    </header>
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border/70 px-4 py-1.5 sm:px-5">
      <div role="group" aria-label="Document view" className="flex gap-1">
        {(["Preview", "Markdown"] as const).map(view => <button key={view} type="button" aria-pressed={sourceView === (view === "Markdown")}
          disabled={view === "Markdown" && markdown === undefined} onClick={() => setSourceView(view === "Markdown")}
          className="min-h-9 rounded px-2.5 text-sm text-muted-foreground aria-pressed:bg-muted aria-pressed:font-semibold aria-pressed:text-foreground disabled:opacity-50">{view}</button>)}
      </div>
      <Button variant="ghost" size="sm" disabled={markdown === undefined} onClick={copyContext}>
        {copyStatus === "copied" ? <Check size={14} /> : <Copy size={14} />} {copyStatus === "copied" ? "Copied" : "Copy Markdown"}
      </Button>
    </div>
    <div className="min-w-0 p-4 sm:p-6">
      {artifact.isPending && <p role="status" className="mb-4 text-sm text-muted-foreground">Opening saved context…</p>}
      {artifact.isError && <div role="alert" className="mb-4 flex items-center gap-3 text-sm text-destructive">
        <p>{artifact.error.message}</p><Button variant="outline" size="sm" onClick={retry}>Retry</Button>
      </div>}
      {download.error && <p role="alert" className="mb-4 text-sm text-destructive">{download.error.message}</p>}
      {copyStatus === "failed" && <p role="status" className="mb-4 text-sm text-muted-foreground">Clipboard access is unavailable. You can select and copy the Markdown.</p>}
      {sourceView && markdown !== undefined ? <pre aria-label="Markdown source" className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-6">{markdown}</pre> :
        preview && <PitchDocument preview={preview} />}
    </div>
  </article>;
};
