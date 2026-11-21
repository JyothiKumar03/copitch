"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const DialogContent = ({ className, children, showCloseButton = true, ...props }: ComponentProps<typeof DialogPrimitive.Content> & { showCloseButton?: boolean }) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay data-slot="dialog-overlay" className="fixed inset-0 z-50 bg-studio-dark/55 backdrop-blur-[2px]" />
    <DialogPrimitive.Content data-slot="dialog-content"
      className={cn("fixed left-1/2 top-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-auto rounded-xl border border-border bg-card p-6 text-card-foreground shadow-xl outline-none", className)}
      {...props}>
      {children}
      {showCloseButton && <DialogClose asChild>
        <Button variant="ghost" size="icon" className="absolute right-2 top-2 size-9 min-h-9" aria-label="Close"><X size={17} /></Button>
      </DialogClose>}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
);

export const DialogHeader = ({ className, ...props }: ComponentProps<"div">) => (
  <div data-slot="dialog-header" className={cn("flex flex-col gap-1.5", className)} {...props} />
);

export const DialogFooter = ({ className, ...props }: ComponentProps<"div">) => (
  <div data-slot="dialog-footer" className={cn("flex flex-wrap items-center justify-end gap-2", className)} {...props} />
);

export const DialogTitle = ({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) => (
  <DialogPrimitive.Title data-slot="dialog-title" className={cn("text-lg font-semibold leading-tight", className)} {...props} />
);

export const DialogDescription = ({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) => (
  <DialogPrimitive.Description data-slot="dialog-description" className={cn("text-sm text-muted-foreground", className)} {...props} />
);
