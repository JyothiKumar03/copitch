"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TContextArtifactProps } from "@/types/research";
import { ContextArtifact } from "./ContextArtifact";

export const ContextFileViewer = ({ onClose, ...props }: TContextArtifactProps & { onClose: () => void }) => {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current;
    const opener = document.activeElement;
    el?.showModal();
    return () => {
      el?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} aria-label="Context artifact" onCancel={event => { event.preventDefault(); onClose(); }}
    className="m-auto max-h-[90dvh] w-[min(56rem,94vw)] overflow-auto rounded-lg border border-border bg-card text-foreground shadow-xl backdrop:bg-black/40">
    <div className="flex justify-end p-2">
      <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close artifact"><X size={18} />Close</Button>
    </div>
    <ContextArtifact {...props} />
  </dialog>;
};
