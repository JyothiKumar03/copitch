"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Check, Copy, Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useContextArtifact } from "@/hooks/research/use-context-artifact";
import type { TContextArtifactProps } from "@/types/research";
import { PitchDocument } from "./PitchDocument";

export const ContextArtifact = ({ close, ...props }: TContextArtifactProps & { close: ReactNode }) => {
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

  return <article aria-label="Context document" className="min-w-0 bg-card">
    <div className="sticky top-0 z-10 border-b border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2.5 sm:px-6 sm:py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold"><FileText size={18} aria-hidden="true" className="text-primary" />context.md</h2>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <Button type="button" variant="outline" size="sm" className="px-2 sm:px-3.5" disabled={markdown === undefined || download.isPending} onClick={() => download.mutate()}>
            <Download size={15} aria-hidden="true" />{download.isPending ? "Downloading…" : "Download context.md"}
          </Button>
          {close}
        </div>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-muted/25 px-3 py-1.5 sm:px-6">
        <div role="group" aria-label="Document view" className="flex gap-0.5 rounded-lg border border-border/70 bg-card p-0.5">
          {(["Preview", "Markdown"] as const).map(view => <Button key={view} type="button" variant="ghost" size="sm" aria-pressed={sourceView === (view === "Markdown")}
            disabled={view === "Markdown" && markdown === undefined} onClick={() => setSourceView(view === "Markdown")}
            className="min-h-8 rounded-md px-2.5 text-sm text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground">{view}</Button>)}
        </div>
        <Button type="button" variant="ghost" size="sm" className="px-2 sm:px-3.5" disabled={markdown === undefined} onClick={copyContext}>
          {copyStatus === "copied" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} {copyStatus === "copied" ? "Copied" : "Copy Markdown"}
        </Button>
      </div>
    </div>
    <div className="mx-auto min-w-0 max-w-3xl p-4 sm:p-8">
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
