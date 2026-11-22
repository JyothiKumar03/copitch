"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, AudioLines, Globe2, LoaderCircle, Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export type TProjectStart = "conversation" | "website";

const starts = [
  { value: "conversation", icon: AudioLines, title: "Talk it through", detail: "Brief copitch by voice or chat. It researches, then drafts slides." },
  { value: "website", icon: Globe2, title: "Start from a website", detail: "Capture a site’s pages and screenshots, then build the deck from them." },
] as const;

type TNewProjectDialogProps = {
  trigger: ReactNode;
  busy: boolean;
  error?: ReactNode;
  onCreate: (name: string, start: TProjectStart) => void;
  onImport?: () => void;
};

export const NewProjectDialog = ({ trigger, busy, error, onCreate, onImport }: TNewProjectDialogProps) => {
  const [start, setStart] = useState<TProjectStart>("conversation");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onCreate(String(new FormData(event.currentTarget).get("name") ?? "").trim(), start);
  };
  return <Dialog>
    <DialogTrigger asChild>{trigger}</DialogTrigger>
    <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
      <div className="relative overflow-hidden border-b border-border px-6 pb-6 pt-7 sm:px-8">
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-24 size-64 rounded-full opacity-70 blur-3xl" style={{ background: "var(--hero-glow)" }} />
        <DialogHeader className="relative gap-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[.14em] text-primary">
            <Sparkles size={13} aria-hidden="true" /> New project
          </p>
          <DialogTitle className="text-3xl font-semibold tracking-[-.045em] sm:text-[2.1rem]">What are you presenting?</DialogTitle>
          <DialogDescription className="max-w-[42ch] leading-relaxed">
            Give it a name you’ll recognise later. Your research, slides and recordings stay private to this project.
          </DialogDescription>
        </DialogHeader>
      </div>
      <form className="grid gap-6 px-6 py-6 sm:px-8" onSubmit={submit}>
        <label className="grid gap-2 text-sm font-semibold" htmlFor="project-name">Project name
          <Input id="project-name" name="name" placeholder="e.g. Series A pitch, Portfolio review" required maxLength={100} autoFocus
            className="h-12 text-base" />
        </label>
        <fieldset className="grid gap-2.5">
          <legend className="mb-2 text-sm font-semibold">Start with</legend>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {starts.map(({ value, icon: Icon, title, detail }) => (
              <label key={value} className="group relative flex cursor-pointer flex-col gap-2 rounded-lg border border-border bg-background/40 p-4 transition-colors hover:border-input has-[:checked]:border-primary has-[:checked]:bg-secondary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring motion-reduce:transition-none">
                <input type="radio" name="start" value={value} checked={start === value} onChange={() => setStart(value)} className="sr-only" />
                <span className="flex items-center justify-between">
                  <span className="grid size-9 place-items-center rounded-md bg-secondary text-primary group-has-[:checked]:bg-primary group-has-[:checked]:text-primary-foreground">
                    <Icon size={17} aria-hidden="true" />
                  </span>
                  <span aria-hidden="true" className="size-4 rounded-full border-2 border-input group-has-[:checked]:border-[5px] group-has-[:checked]:border-primary" />
                </span>
                <span className="text-sm font-semibold">{title}</span>
                <span className="text-xs leading-relaxed text-muted-foreground">{detail}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {error}
        <DialogFooter className="justify-between gap-3 border-t border-border pt-5">
          {onImport ? <Button type="button" variant="link" className="px-0" disabled={busy} onClick={onImport}>
            <Upload size={14} aria-hidden="true" /> Import this tab’s previous pitch
          </Button> : <span />}
          <Button type="submit" disabled={busy}>
            {busy ? <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
            Create project <ArrowRight size={16} aria-hidden="true" />
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
};
