"use client";

import Image from "next/image";
import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Check, CircleAlert, Globe2, Image as ImageIcon, LoaderCircle, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { approveWalkthrough, captureImage, downloadWalkthrough, listWalkthroughs, loadWalkthrough } from "@/lib/website-walkthrough";
import { DEFAULT_WEBSITE_WALKTHROUGH_DEPTH, WEBSITE_WALKTHROUGH_DEPTHS } from "../../../shared/website-walkthrough";
import type { TWebsiteWalkthrough, TWebsiteWalkthroughInput } from "../../../shared/website-walkthrough";

type TWalkthroughDraft = Pick<TWebsiteWalkthroughInput, "url" | "audience" | "goal" | "max_depth">;
const blank: TWalkthroughDraft = { url: "", audience: "", goal: "", max_depth: DEFAULT_WEBSITE_WALKTHROUGH_DEPTH };
const depthOptions = { 0: "Starting page only", 1: "One level of links", 2: "Two levels of links", 3: "Three levels of links" };
const depthLabel = (value: number) => depthOptions[WEBSITE_WALKTHROUGH_DEPTHS.find(depth => depth === value) ?? DEFAULT_WEBSITE_WALKTHROUGH_DEPTH];
const dateLabel = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const statusLabel: Record<TWebsiteWalkthrough["status"], string> = {
  queued: "Capture queued", capturing: "Capturing pages", exporting: "Building PowerPoint", completed: "PowerPoint ready", failed: "Walkthrough stopped",
};
const inProgress = (status?: TWebsiteWalkthrough["status"]) => status === "queued" || status === "capturing" || status === "exporting";

const displaySite = (url: string) => {
  try { return new URL(url).hostname; } catch { return url; }
};

const scopeUrl = (value: string) => {
  const url = new URL(value.trim());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Enter a public HTTP or HTTPS URL.");
  url.hash = "";
  return url.href;
};

const ScopeFields = ({ scope }: { scope: TWalkthroughDraft }) => (
  <dl className="grid gap-4 text-sm leading-relaxed">
    {[["Starting page", scope.url], ["Audience", scope.audience], ["Goal", scope.goal], ["Crawl depth", depthLabel(scope.max_depth)]].map(([label, value]) => <div key={label}>
      <dt className="text-xs font-semibold text-muted-foreground">{label}</dt><dd className="mt-1 wrap-anywhere">{value}</dd>
    </div>)}
  </dl>
);

const WalkthroughResult = ({ projectId, item }: { projectId: string; item: TWebsiteWalkthrough }) => {
  const download = useMutation({ mutationFn: () => downloadWalkthrough(projectId, item.walkthrough_id) });
  const active = inProgress(item.status);
  const gapCount = item.attempts.filter(attempt => attempt.status === "failed").length;
  return <div className="grid min-w-0 gap-4">
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p role="status" className="flex items-center gap-2 text-sm font-semibold">
            {active ? <LoaderCircle size={16} className="animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" /> :
              item.status === "completed" ? <Check size={16} className="text-primary" aria-hidden="true" /> : <CircleAlert size={16} className="text-destructive" aria-hidden="true" />}
            {statusLabel[item.status]}
          </p>
          <h2 className="mt-1 wrap-anywhere text-2xl font-semibold tracking-[-.045em]">{displaySite(item.url)}</h2>
        </div>
        {item.status === "completed" && <Button type="button" disabled={download.isPending} onClick={() => download.mutate()}>
          <ArrowDownToLine size={16} aria-hidden="true" />{download.isPending ? "Downloading…" : "Download PowerPoint"}
        </Button>}
      </CardHeader>
      <CardContent className="grid gap-3">
        <ScopeFields scope={item} />
        {item.error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{item.error}</p>}
        {download.error && <p role="alert" className="text-sm text-destructive">{download.error.message}</p>}
      </CardContent>
    </Card>
    {!!item.pages.length && <section aria-labelledby="walkthrough-pages" className="min-w-0">
      <div className="mb-3 flex items-baseline gap-2"><h2 id="walkthrough-pages" className="text-xl font-semibold tracking-tight">Captured pages</h2><span className="text-sm tabular-nums text-muted-foreground">{item.pages.length}</span></div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {item.pages.map(page => <Card key={page.capture_id} className="overflow-hidden">
          <div className="aspect-[8/5] overflow-hidden border-b border-border bg-muted">
            <Image unoptimized width={1440} height={900} alt={`Screenshot of ${page.title}`} className="size-full object-contain" src={captureImage(projectId, item.walkthrough_id, page.capture_id)} />
          </div>
          <CardContent className="px-3.5 py-3">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h3 className="min-w-0 wrap-anywhere text-base font-semibold leading-snug">{page.title}</h3>
              {page.depth !== undefined && <Badge variant="outline" className="font-normal text-muted-foreground">Depth {page.depth}</Badge>}
            </div>
            <a className="mt-1 inline-flex max-w-full items-start gap-1.5 text-sm text-evidence underline-offset-2 hover:underline" href={page.url} target="_blank" rel="noreferrer">
              <span className="min-w-0 wrap-anywhere">{page.url}</span><ArrowUpRight size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            </a>
            {!!page.facts.length && <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-muted-foreground">{page.facts.map((fact, index) => <li key={index} className="wrap-anywhere">{fact}</li>)}</ul>}
          </CardContent>
        </Card>)}
      </div>
    </section>}
    {!!item.attempts.length && <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Capture activity</h2>
        {gapCount > 0 && <Badge variant="outline" className="text-evidence"><CircleAlert size={14} aria-hidden="true" />{gapCount} {gapCount === 1 ? "gap" : "gaps"}</Badge>}
      </CardHeader>
      <CardContent className="px-5 py-3">
        <ol className="divide-y divide-border text-sm" aria-label="Visited and attempted pages">{item.attempts.map((attempt, index) => <li key={index} className="grid gap-1 py-2.5 wrap-anywhere">
          <div className="grid gap-x-3 gap-y-1 sm:flex sm:flex-wrap sm:items-baseline">
            <span className="min-w-0 flex-1 font-medium">{attempt.url}</span>
            <span className="flex flex-wrap items-center gap-2">
              {attempt.depth !== undefined && <span className="text-xs text-muted-foreground">Depth {attempt.depth}</span>}
              <Badge variant="outline" className={attempt.status === "failed" ? "text-evidence" : "text-muted-foreground"}>{attempt.status === "captured" ? "Captured" : "Couldn’t capture"}</Badge>
            </span>
          </div>
          {attempt.observed_url && attempt.observed_url !== attempt.url && <span className="text-xs text-muted-foreground">Opened {attempt.observed_url}</span>}
          {attempt.status === "failed" && <span className="text-muted-foreground">{attempt.reason ?? "The page could not be read."}</span>}
        </li>)}</ol>
      </CardContent>
    </Card>}
  </div>;
};

export const WebsiteWalkthrough = ({ projectId }: { projectId: string }) => {
  const client = useQueryClient();
  const listKey = ["website-walkthroughs", projectId];
  const [selectedId, setSelectedId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(blank);
  const [approval, setApproval] = useState<TWebsiteWalkthroughInput | null>(null);
  const [formError, setFormError] = useState("");
  const approvalHeading = useRef<HTMLHeadingElement>(null);
  const siteInput = useRef<HTMLInputElement>(null);
  const resultPanel = useRef<HTMLDivElement>(null);
  const focusInput = () => requestAnimationFrame(() => siteInput.current?.focus());
  const focusResult = () => requestAnimationFrame(() => resultPanel.current?.focus());
  const saved = useQuery({ queryKey: listKey, queryFn: ({ signal }) => listWalkthroughs(projectId, signal), retry: false });
  const currentId = selectedId ?? saved.data?.[0]?.walkthrough_id;
  const current = useQuery({ queryKey: [...listKey, currentId], enabled: !!currentId, queryFn: ({ signal }) => loadWalkthrough(projectId, currentId!, signal),
    initialData: () => saved.data?.find(item => item.walkthrough_id === currentId), retry: false,
    refetchInterval: query => inProgress(query.state.data?.status) ? 1100 : false,
  });
  const start = useMutation({
    mutationFn: (input: TWebsiteWalkthroughInput) => approveWalkthrough(projectId, input),
    onSuccess: item => {
      client.setQueryData<TWebsiteWalkthrough[]>(listKey, existing => [item, ...(existing ?? []).filter(row => row.walkthrough_id !== item.walkthrough_id)]);
      client.setQueryData([...listKey, item.walkthrough_id], item);
      setSelectedId(item.walkthrough_id);
      setCreating(false); setApproval(null); setForm(blank);
      focusResult();
    },
  });
  const showForm = creating || !currentId && !saved.isPending;
  const change = <K extends keyof TWalkthroughDraft>(key: K, value: TWalkthroughDraft[K]) => setForm(current => ({ ...current, [key]: value }));
  const review = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(""); start.reset();
    try {
      const audience = form.audience.trim();
      const goal = form.goal.trim();
      if (!audience || !goal) { setFormError("Enter an audience and presentation goal."); return; }
      setApproval({ request_id: crypto.randomUUID(), url: scopeUrl(form.url), audience, goal, max_depth: form.max_depth, approved: true });
      requestAnimationFrame(() => approvalHeading.current?.focus());
    } catch { setFormError("Enter a public HTTP or HTTPS URL without credentials."); }
  };
  const openSaved = (id: string) => { setSelectedId(id); setCreating(false); setApproval(null); start.reset(); focusResult(); };

  return <section aria-labelledby="website-walkthrough-title" className="mx-auto grid max-w-7xl min-w-0 gap-5 pb-8 pt-3">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
      <div><h2 id="website-walkthrough-title" className="flex items-center gap-2 text-2xl font-semibold tracking-[-.04em] sm:text-3xl"><Globe2 size={23} className="text-primary" aria-hidden="true" />Website walkthrough</h2>
        <p className="mt-1 text-sm text-muted-foreground">Turn pages from a public website into a PowerPoint for your audience.</p></div>
      {!showForm && <Button type="button" variant="outline" disabled={inProgress(current.data?.status)} onClick={() => { setCreating(true); setApproval(null); start.reset(); focusInput(); }}><Plus size={16} aria-hidden="true" />New walkthrough</Button>}
    </header>
    {saved.error && <p role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">{saved.error.message}<Button size="sm" variant="outline" onClick={() => void saved.refetch()}>Retry</Button></p>}
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(12rem,16rem)_minmax(0,1fr)]">
      <Card className="order-2 lg:order-1" aria-label="Saved walkthroughs">
        <CardHeader className="px-4 pt-4"><h3 className="flex items-center gap-2 text-sm font-semibold"><ImageIcon size={16} className="text-muted-foreground" aria-hidden="true" />Saved walkthroughs</h3></CardHeader>
        <CardContent className="p-2.5">
          {saved.data?.length ? <ul className="grid min-w-0 gap-1">{saved.data.map(item => <li key={item.walkthrough_id}>
            <Button type="button" size="sm" variant="ghost" disabled={start.isPending} onClick={() => openSaved(item.walkthrough_id)}
              aria-current={!showForm && item.walkthrough_id === currentId ? "step" : undefined} className="grid w-full justify-items-start justify-start gap-1 px-2.5 py-2.5 text-left whitespace-normal aria-current:bg-accent">
              <span className="wrap-anywhere">{displaySite(item.url)}</span><span className="text-xs font-normal text-muted-foreground">{dateLabel.format(item.created_at)}</span>
              <span className="text-xs text-muted-foreground">{statusLabel[current.data?.walkthrough_id === item.walkthrough_id ? current.data.status : item.status]}</span>
            </Button>
          </li>)}</ul> : <p className="px-1.5 py-2 text-sm text-muted-foreground">{saved.isPending ? "Opening saved walkthroughs…" : "No walkthroughs yet."}</p>}
        </CardContent>
      </Card>
      <div className="order-1 min-w-0 lg:order-2">
        {showForm ? <Card>
          <CardHeader>
            {approval ? <><Badge variant="outline" className="text-evidence">Approval required</Badge><h3 ref={approvalHeading} tabIndex={-1} className="text-xl font-semibold">Review capture scope</h3></> : <h3 className="text-xl font-semibold">Set the walkthrough scope</h3>}
          </CardHeader>
          <CardContent>
            {approval ? <div className="grid gap-4">
              <ScopeFields scope={approval} />
              <p className="text-sm text-muted-foreground">Copitch will read pages on this website and save screenshots in this project.</p>
              {start.error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{start.error.message}</p>}
              <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={start.isPending} onClick={() => start.mutate(approval)}>{start.isPending ? "Starting…" : "Approve and capture"}<ArrowRight size={16} aria-hidden="true" /></Button>
                <Button type="button" variant="outline" disabled={start.isPending} onClick={() => { setApproval(null); start.reset(); focusInput(); }}>Edit scope</Button>
              </div>
            </div> : <form onSubmit={review} className="grid gap-4">
              <label className="grid gap-1.5 text-sm font-semibold">Public website URL<Input ref={siteInput} type="url" inputMode="url" value={form.url} onChange={event => change("url", event.target.value)} maxLength={2048} required placeholder="https://" /></label>
              <label className="grid gap-1.5 text-sm font-semibold">Audience<Input value={form.audience} onChange={event => change("audience", event.target.value)} maxLength={180} required placeholder="e.g. New customers" /></label>
              <label className="grid gap-1.5 text-sm font-semibold">Presentation goal<Textarea rows={3} value={form.goal} onChange={event => change("goal", event.target.value)} maxLength={600} required placeholder="What should the audience learn or decide?" /></label>
              <label className="grid gap-1.5 text-sm font-semibold">Crawl depth
                <NativeSelect className="min-h-11" value={form.max_depth} onChange={event => {
                  const depth = WEBSITE_WALKTHROUGH_DEPTHS.find(value => String(value) === event.target.value);
                  if (depth !== undefined) change("max_depth", depth);
                }}>
                  {WEBSITE_WALKTHROUGH_DEPTHS.map(depth => <NativeSelectOption key={depth} value={depth}>{depth} · {depthOptions[depth]}</NativeSelectOption>)}
                </NativeSelect>
              </label>
              {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
              <div className="flex flex-wrap gap-2"><Button type="submit">Review capture scope<ArrowRight size={16} aria-hidden="true" /></Button>
                {creating && currentId && <Button type="button" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>}
              </div>
            </form>}
          </CardContent>
        </Card> : current.data ? <div ref={resultPanel} tabIndex={-1} role="region" aria-label="Walkthrough result" className="min-w-0 rounded-lg"><WalkthroughResult key={current.data.walkthrough_id} projectId={projectId} item={current.data} /></div> : current.error ?
          <p role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">{current.error.message}<Button size="sm" variant="outline" onClick={() => void current.refetch()}>Retry</Button></p> :
          <p role="status" className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Opening walkthrough…</p>}
        {current.error && current.data && !showForm && <p role="alert" className="mt-3 flex flex-wrap items-center gap-3 text-sm text-destructive">{current.error.message}<Button size="sm" variant="outline" onClick={() => void current.refetch()}>Retry</Button></p>}
      </div>
    </div>
  </section>;
};
