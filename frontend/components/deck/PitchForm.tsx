"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TPitchFormProps } from "@/types/deck";

export const PitchForm = ({ initial, pending, onPrepare }: TPitchFormProps) => {
  const [audience, setAudience] = useState(initial?.audience ?? "");
  const [duration, setDuration] = useState(String(initial?.duration_minutes ?? 5));
  const [count, setCount] = useState(initial?.slide_count?.toString() ?? "");
  const [url, setUrl] = useState(initial?.demo?.url ?? "");
  const [objective, setObjective] = useState(initial?.demo?.objective ?? "");
  const [seconds, setSeconds] = useState(String(initial?.demo?.seconds ?? 60));
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
      <details className="col-span-full border-y border-border py-3"><summary className="cursor-pointer text-sm font-medium">Slide count and walkthrough</summary>
        <label>Slide count <Input placeholder="Let the planner choose" type="number" min={1} max={100} value={count} onChange={e => setCount(e.target.value)} /></label>
        <label>Walkthrough URL <Input type="url" placeholder="https://…" value={url} onChange={e => setUrl(e.target.value)} /></label>
        {!!url && <><label>What should the audience see? <Input required maxLength={240} value={objective} onChange={e => setObjective(e.target.value)} /></label>
          <label>Walkthrough time (seconds) <Input required type="number" min={1} max={3600} value={seconds} onChange={e => setSeconds(e.target.value)} /></label></>}
      </details>
      <Button type="submit" className="justify-self-start" disabled={pending}>{pending ? "Preparing slides…" : "Prepare slides"}</Button>
    </form>
  );
};
