"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TPitchContentProps } from "@/types/pitch-content";
import { PitchArtifact } from "./PitchArtifact";

export const PitchFileViewer = ({ onClose, ...props }: TPitchContentProps & { onClose: () => void }) => {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return <dialog ref={dialog} aria-label="Pitch artifact" onCancel={onClose}
    className="m-auto max-h-[90dvh] w-[min(56rem,94vw)] overflow-auto rounded-lg border border-border bg-card text-foreground shadow-xl backdrop:bg-black/40">
    <div className="flex justify-end p-2">
      <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close artifact"><X size={18} />Close</Button>
    </div>
    <PitchArtifact {...props} />
  </dialog>;
};
