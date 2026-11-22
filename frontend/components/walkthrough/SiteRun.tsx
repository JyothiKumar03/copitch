"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight, Globe2, Plus, Square } from "lucide-react";
import type { TSiteRun, TSiteRunInput } from "../../../shared/site-run";
import { DEFAULT_WEBSITE_WALKTHROUGH_DEPTH, WEBSITE_WALKTHROUGH_DEPTHS } from "../../../shared/website-walkthrough";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { attachSiteRun, downloadSiteRun, isSiteRunUrl, listSiteRuns, readSiteRun, siteStepImage, startSiteRun, stopSiteRun } from "@/lib/site-run";
import { PowerPointSelection } from "./PowerPointSelection";

type TSiteDraft = Pick<TSiteRunInput, "url" | "audience" | "goal" | "max_depth">;
const empty: TSiteDraft = { url: "", audience: "", goal: "", max_depth: DEFAULT_WEBSITE_WALKTHROUGH_DEPTH };
const statusLabels: Record<TSiteRun["status"], string> = {
  queued: "Walkthrough queued", running: "Walking through the site", completed: "Walkthrough ready", failed: "Walkthrough stopped early", stopped: "Walkthrough stopped",
};
const active = (run?: TSiteRun) => run?.status === "queued" || run?.status === "running";
const price = new Intl.NumberFormat("en", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

const Scope = ({ scope }: { scope: TSiteDraft }) => <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
  {[["Starting page", scope.url], ["Audience", scope.audience], ["Goal", scope.goal], ["Crawl depth", String(scope.max_depth)]].map(([label, content]) =>
    <div key={label} className="min-w-0"><dt className="font-medium text-muted-foreground">{label}</dt><dd className="wrap-anywhere">{content}</dd></div>)}
</dl>;

const SavedRun = ({ projectId, run, onStop, stopping }: { projectId: string; run: TSiteRun; onStop: () => void; stopping: boolean }) => {
  const router = useRouter();
  const client = useQueryClient();
  const attach = useMutation({ mutationFn: () => attachSiteRun(projectId, run.run_id),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["host-workspace", projectId] });
      router.push(`/research?project=${encodeURIComponent(projectId)}`);
    },
  });
  return <div className="grid min-w-0 gap-4">
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><p role="status" className="text-sm font-semibold text-primary">{statusLabels[run.status]}</p>
          <h3 className="mt-1 wrap-anywhere text-2xl font-semibold tracking-tight">{new URL(run.url).hostname}</h3></div>
        <div className="flex flex-wrap gap-2">
          {run.resumed && <Badge variant="outline">Resumed</Badge>}
          {active(run) && <Button type="button" variant="outline" onClick={onStop} disabled={stopping}><Square size={14} aria-hidden="true" />Stop walkthrough</Button>}
          {!active(run) && !!run.steps.length && <Button type="button" variant="outline" onClick={() => attach.mutate()} disabled={attach.isPending}>Use all steps in presenter studio <ArrowRight size={14} aria-hidden="true" /></Button>}
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Scope scope={run} />
        <p className="text-sm text-muted-foreground">{run.engine === "model" ? "Model-guided browser" : "Goal-ranked browser"} · {price.format(run.spent_usd)} of {price.format(run.budget_usd)} {run.usage_estimated ? "estimated" : "used"}</p>
        {!!run.receipts?.length && <details className="text-sm"><summary className="cursor-pointer">Model usage ({run.receipts.length} attempts)</summary>
          <ol className="mt-2 space-y-1">{run.receipts.map(receipt => <li key={receipt.n}>
            {receipt.n}. {receipt.model} · {receipt.status} · {price.format(receipt.priced_usd)}
            {receipt.estimated ? " reserved" : ` from ${receipt.input_tokens ?? "unknown"} input and ${receipt.output_tokens ?? "unknown"} output tokens`}
          </li>)}</ol></details>}
        {run.summary && <p className="text-sm text-muted-foreground">{run.summary}</p>}
        {attach.error && <p role="alert" className="text-sm text-destructive">{attach.error.message}</p>}
      </CardContent>
    </Card>
    {!active(run) && (!!run.steps.length || run.has_powerpoint) && <PowerPointSelection projectId={projectId}
      source={{ kind: "site-runs", captureId: run.run_id }} imageUrl={pageNumber => siteStepImage(projectId, run.run_id, pageNumber)}
      downloadArchived={() => downloadSiteRun(projectId, run.run_id)} />}
    {!!run.steps.length && <section className="grid min-w-0 gap-3" aria-label="Recorded steps">
      <h3 className="text-xl font-semibold tracking-tight">Recorded steps <span className="ml-1 text-sm font-normal text-muted-foreground">{run.steps.length}</span></h3>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {run.steps.map(step => <Card key={step.n} className="overflow-hidden">
          <div className="aspect-[8/5] overflow-hidden border-b border-border bg-muted">
            <Image unoptimized src={siteStepImage(projectId, run.run_id, step.n)} alt={`Recorded screen for ${step.title}`}
              width={1440} height={900} className="size-full object-contain" />
          </div>
          <CardContent className="grid gap-1.5 px-4 py-3">
            <h4 className="wrap-anywhere font-semibold"><span className="mr-1 text-muted-foreground">{step.n}.</span>{step.title}</h4>
            <p className="wrap-anywhere text-sm text-muted-foreground">{step.caption}</p>
            <a className="inline-flex w-fit max-w-full items-start gap-1 text-sm text-evidence underline-offset-2 hover:underline" href={step.url} target="_blank" rel="noreferrer">
              <span className="wrap-anywhere">{step.url}</span><ArrowUpRight size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            </a>
            <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">{step.facts.map(fact => <li key={fact} className="wrap-anywhere">{fact}</li>)}</ul>
          </CardContent>
        </Card>)}
      </div>
    </section>}
    <Card>
      <CardHeader><h3 className="font-semibold">Coverage</h3></CardHeader>
      <CardContent className="grid min-w-0 gap-3 text-sm text-muted-foreground">
        <p>{run.coverage.visited.length} visited · {run.coverage.walls.length} blocked · {run.coverage.frontier} remaining</p>
        {!!run.coverage.visited.length && <details><summary className="cursor-pointer font-medium text-foreground">Visited pages</summary>
          <ul className="mt-2 grid gap-2">{run.coverage.visited.map(url => <li key={url}><a className="wrap-anywhere underline" href={url} target="_blank" rel="noreferrer">{url}</a></li>)}</ul></details>}
        {!!run.coverage.remaining?.length && <details><summary className="cursor-pointer font-medium text-foreground">Remaining paths (showing {run.coverage.remaining.length})</summary>
          <ul className="mt-2 grid gap-2">{run.coverage.remaining.map(item => <li key={item.url}><a className="wrap-anywhere underline" href={item.url} target="_blank" rel="noreferrer">{item.label}</a></li>)}</ul></details>}
        {!!run.coverage.walls.length && <details><summary className="cursor-pointer font-medium text-foreground">Blocked paths</summary>
          <ul className="mt-2 grid gap-2">{run.coverage.walls.map((wall, index) => <li key={index} className="wrap-anywhere"><strong className="text-foreground">{wall.label}</strong> · {wall.reason}</li>)}</ul></details>}
        {!!run.activity.length && <details open={active(run)}><summary className="cursor-pointer font-medium text-foreground">Browser activity</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">{run.activity.slice(-12).map(item => <li key={item.n} className="wrap-anywhere">{item.label}</li>)}</ol></details>}
      </CardContent>
    </Card>
  </div>;
};

export const SiteRun = ({ projectId }: { projectId: string }) => {
  const client = useQueryClient();
  const key = ["site-runs", projectId];
  const [draft, setDraft] = useState<TSiteDraft>(empty);
  const [selected, setSelected] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [approval, setApproval] = useState<TSiteRunInput>();
  const [error, setError] = useState("");
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const list = useQuery({ queryKey: key, queryFn: ({ signal }) => listSiteRuns(projectId, signal), retry: false });
  const id = selected ?? list.data?.[0]?.run_id;
  const query = useQuery({ queryKey: [...key, id], enabled: !!id, queryFn: ({ signal }) => readSiteRun(projectId, id!, signal),
    initialData: () => list.data?.find(entry => entry.run_id === id), refetchInterval: observer => active(observer.state.data) ? 900 : false, retry: false,
  });
  const refresh = (run: TSiteRun) => {
    client.setQueryData([...key, run.run_id], run);
    client.setQueryData<TSiteRun[]>(key, previous => [run, ...(previous ?? []).filter(entry => entry.run_id !== run.run_id)]);
  };
  const start = useMutation({ mutationFn: (input: TSiteRunInput) => startSiteRun(projectId, input),
    onSuccess: run => { refresh(run); setSelected(run.run_id); setCreating(false); setApproval(undefined); setDraft(empty); } });
  const stop = useMutation({ mutationFn: (runId: string) => stopSiteRun(projectId, runId), onSuccess: refresh });
  const review = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(""); start.reset();
    try {
      const value = draft.url.trim();
      const url = new URL(/^[a-z][a-z\d+.-]*:\/\//iu.test(value) ? value : "https://" + value);
      if (!isSiteRunUrl(url.href) || url.port || url.search || !url.hostname.includes(".")) throw new Error();
      url.hash = "";
      setApproval({ ...draft, url: url.href, audience: draft.audience.trim(), goal: draft.goal.trim(), request_id: crypto.randomUUID(), approved: true });
      requestAnimationFrame(() => reviewHeading.current?.focus());
    } catch { setError("Enter a public HTTP or HTTPS page without credentials or query parameters."); }
  };
  const showForm = creating || !id && !list.isPending;
  return <section className="mx-auto grid max-w-7xl min-w-0 gap-5 pb-8 pt-3" aria-labelledby="site-run-title">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
      <div className="min-w-0"><h2 id="site-run-title" className="flex items-center gap-2 text-2xl font-semibold tracking-tight sm:text-3xl"><Globe2 size={23} className="text-primary" aria-hidden="true" />Agent walkthrough</h2>
        <p className="mt-1 text-sm text-muted-foreground">Give the browser a goal. Review its steps, screenshots and coverage before using them in a deck.</p></div>
      {!showForm && <Button type="button" variant="outline" onClick={() => { setCreating(true); stop.reset(); }} disabled={active(query.data)}><Plus size={15} aria-hidden="true" />New walkthrough</Button>}
    </header>
    {list.isPending && <p role="status" className="text-sm text-muted-foreground">Opening walkthroughs…</p>}
    {(list.error || query.error || stop.error) && <p role="alert" className="text-sm text-destructive">{(list.error ?? query.error ?? stop.error)?.message}</p>}
    {!!list.data?.length && <nav aria-label="Saved agent walkthroughs" className="flex min-w-0 flex-wrap gap-2">
      {list.data.map(item => <Button key={item.run_id} type="button" size="sm" title={item.goal}
        aria-pressed={!showForm && item.run_id === id} variant={item.run_id === id && !showForm ? "secondary" : "outline"}
        onClick={() => { setSelected(item.run_id); setCreating(false); setApproval(undefined); stop.reset(); }} className="max-w-full whitespace-normal text-left">
        {new URL(item.url).hostname} <span className="text-xs text-muted-foreground">{date.format(item.created_at)}</span>
      </Button>)}
    </nav>}
    {showForm ? <Card className="w-full max-w-3xl">
      <CardHeader><h3 ref={reviewHeading} tabIndex={-1} className="text-lg font-semibold">{approval ? "Review the walkthrough" : "Set the site and goal"}</h3></CardHeader>
      <CardContent>
        {approval ? <div className="grid gap-4">
          <Scope scope={approval} />
          <p className="text-sm text-muted-foreground">Approve saving screenshots and visible facts from these public pages to your private project. The browser skips sign-in, payments and actions that change the site.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={start.isPending} onClick={() => start.mutate(approval)}>{start.isPending ? "Starting…" : "Approve and start"}</Button>
            <Button type="button" variant="outline" disabled={start.isPending} onClick={() => { start.reset(); setApproval(undefined); }}>Edit scope</Button>
          </div>
          {start.error && <p role="alert" className="text-sm text-destructive">{start.error.message}</p>}
        </div> : <form className="grid gap-4" onSubmit={review}>
          <label className="grid gap-1.5 text-sm font-medium">Starting page<Input value={draft.url} onChange={event => setDraft({ ...draft, url: event.currentTarget.value })} required placeholder="example.com" maxLength={2048} /></label>
          <label className="grid gap-1.5 text-sm font-medium">Audience<Input value={draft.audience} onChange={event => setDraft({ ...draft, audience: event.currentTarget.value })} required maxLength={180} /></label>
          <label className="grid gap-1.5 text-sm font-medium">Walkthrough goal<Textarea value={draft.goal} onChange={event => setDraft({ ...draft, goal: event.currentTarget.value })} required maxLength={600} /></label>
          <label className="grid gap-1.5 text-sm font-medium">Crawl depth<NativeSelect value={draft.max_depth} onChange={event => setDraft({ ...draft, max_depth: Number(event.currentTarget.value) })}>
            {WEBSITE_WALKTHROUGH_DEPTHS.map(depth => <NativeSelectOption value={depth} key={depth}>{depth === 0 ? "Starting page only" : `${depth} ${depth === 1 ? "level" : "levels"} of links`}</NativeSelectOption>)}
          </NativeSelect></label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button className="w-fit" type="submit">Review walkthrough <ArrowRight size={15} aria-hidden="true" /></Button>
        </form>}
      </CardContent>
    </Card> : query.data && <SavedRun key={query.data.run_id} projectId={projectId} run={query.data} stopping={stop.isPending} onStop={() => stop.mutate(query.data!.run_id)} />}
  </section>;
};
