"use client";

import { useState } from "react";
import { ChevronDown, Presentation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import type { TPitchFormProps } from "@/types/deck";

export const PitchForm = ({ initial, pending, onPrepare }: TPitchFormProps) => {
  const [audience, setAudience] = useState(initial?.audience ?? "");
  const [duration, setDuration] = useState(String(initial?.duration_minutes ?? 5));
  const [count, setCount] = useState(initial?.slide_count?.toString() ?? "");
  const [url, setUrl] = useState(initial?.demo?.url ?? "");
  const [objective, setObjective] = useState(initial?.demo?.objective ?? "");
  const [seconds, setSeconds] = useState(String(initial?.demo?.seconds ?? 60));
  const [advanced, setAdvanced] = useState(false);
  return (
    <form className="pitch-form" onSubmit={event => {
      event.preventDefault();
      onPrepare({ audience: audience.trim(), duration_minutes: duration ? Number(duration) : 5,
        ...(count && { slide_count: Number(count) }),
        ...(url.trim() && { demo: { url: url.trim(), objective: objective.trim(), seconds: Number(seconds) } }) });
    }}>
      <label>Audience
        <Input maxLength={6000} placeholder="Use the audience from my brief" value={audience} onChange={event => setAudience(event.target.value)} />
      </label>
      <label>Speaking time (minutes)
        <Input type="number" min={1} max={60} step={1} value={duration} onChange={event => setDuration(event.target.value)} />
      </label>
      <Collapsible open={advanced} onOpenChange={setAdvanced} className="col-span-full border-y border-border py-1">
        <CollapsibleTrigger asChild>
          <Button type="button" size="sm" variant="ghost" className="group w-full justify-between px-2 hover:bg-muted" disabled={pending}>
            Slide count and walkthrough<ChevronDown size={15} aria-hidden="true" className="motion-safe:transition-transform group-data-[state=open]:rotate-180" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent forceMount className="pitch-form px-2 py-3 data-[state=closed]:hidden" onInvalid={() => setAdvanced(true)}>
          <label>Slide count <Input placeholder="Let the planner choose" type="number" min={1} max={100} value={count} onChange={e => setCount(e.target.value)} /></label>
          <label>Walkthrough URL <Input type="url" placeholder="https://…" value={url} onChange={e => setUrl(e.target.value)} /></label>
          {!!url && <><label>What should the audience see? <Input required maxLength={240} value={objective} onChange={e => setObjective(e.target.value)} /></label>
            <label>Walkthrough time (seconds) <Input required type="number" min={1} max={3600} value={seconds} onChange={e => setSeconds(e.target.value)} /></label></>}
        </CollapsibleContent>
      </Collapsible>
      <Button type="submit" className="col-span-full justify-self-start" disabled={pending}><Presentation size={16} aria-hidden="true" />{pending ? "Preparing slides…" : "Prepare slides"}</Button>
    </form>
  );
};
