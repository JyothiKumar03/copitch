"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { TContextArtifactProps } from "@/types/research";
import { ContextArtifact } from "./ContextArtifact";

export const ContextFileViewer = ({ onClose, restoreFocus, ...props }: TContextArtifactProps & {
  onClose: () => void;
  restoreFocus: () => void;
}) => (
  <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent showCloseButton={false} aria-describedby={undefined}
      onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }}
      className="block max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-4xl gap-0 overflow-x-hidden p-0 sm:max-h-[90dvh] sm:w-[calc(100%-2rem)]">
      <DialogTitle className="sr-only">Context artifact</DialogTitle>
      <ContextArtifact {...props} close={<DialogClose asChild>
        <Button type="button" variant="ghost" size="icon" className="size-9" aria-label="Close artifact"><X size={18} aria-hidden="true" /></Button>
      </DialogClose>} />
    </DialogContent>
  </Dialog>
);
