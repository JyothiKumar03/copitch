"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight, Check, CircleHelp, ClipboardList, RotateCcw, Square, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { TMission, TOutcomeContract } from "../../../shared/mission";
import { MAX_PRESENTATION_SLIDES } from "../../../shared/presentation";

type TMissionPanelProps = {
  mission: TMission;
  sources: { source_id: string; filename: string }[];
  busy: boolean;
  approvalBlocked?: boolean;
  error?: string;
  onApprove: () => void;
  onRetry: () => void;
  onRevise: (contract: TOutcomeContract) => void;
  onStop: () => void;
  onTakeOver: () => void;
  onReview: () => void;
  onReply: () => void;
};

type TPlanRow = { label: string; values: string[] };
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const planRows = (contract: TOutcomeContract, filenames: Map<string, string>): TPlanRow[] => {
  const { deliverable, sources, budget } = contract;
  return [
    { label: "Subject", values: [contract.subject] },
    { label: "Audience", values: [contract.audience] },
    { label: "Purpose", values: [contract.purpose] },
    { label: "Deliverable", values: [deliverable.slide_count === "auto" ? "Slide deck · automatic slide count" : `${deliverable.slide_count} slides`,
      ...(deliverable.tone ? [deliverable.tone] : []), ...(deliverable.max_minutes ? [`Up to ${deliverable.max_minutes} minutes of presentation time`] : [])] },
    { label: "Required facts", values: contract.must_include.map(fact => `${fact.text} (H · from you)`) },
    { label: "Files", values: sources.files.map(id => filenames.get(id) ?? "An attached file") },
    { label: "Pasted source text", values: sources.materials ? [sources.materials] : [] },
    { label: "Public links", values: sources.urls },
    { label: "Website tasks", values: sources.site_tasks.map(task => `${task.url} · ${task.goal} (${task.mode === "read" ? "read-only" : "interactive"})`) },
    { label: "Public search", values: [sources.public_search ? "Allowed" : "Off"] },
    { label: "Budget", values: [`${usd.format(budget.usd)} USD · ${budget.minutes} minutes`] },
    { label: "Success checks", values: contract.success_checks },
  ];
};

const displayRows = (rows: TPlanRow[]) => rows.filter(row => row.values.length);
const statusLabel = (mission: TMission) => {
  if (mission.status === "delivered" && mission.deck_id) return mission.gaps.length ? "Partial result" : "Ready to present";
  if (mission.status === "stopped") return "Stopped";
  if (mission.status === "paused") return "Paused · manual control";
  if (mission.status === "needs_input" || mission.status === "needs_approval") return "Needs you";
  if (mission.status === "delivered") return "Finished";
  return "Working";
};

const ScopeEditor = ({ contract, sources, busy, onSave, onCancel }: {
  contract: TOutcomeContract; sources: TMissionPanelProps["sources"]; busy: boolean;
  onSave: TMissionPanelProps["onRevise"]; onCancel: () => void;
}) => {
  const editId = useId();
  const firstField = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const existingTask = contract.sources.site_tasks.find(task => task.mode === "read");
  useEffect(() => { firstField.current?.focus(); }, []);
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const value = (name: string) => String(fields.get(name) ?? "").trim();
    const lines = (name: string) => value(name).split("\n").map(line => line.trim()).filter(Boolean);
    const urls = lines("urls");
    const facts = lines("facts");
    const siteUrl = value("site_url");
    const siteGoal = value("site_goal");
    const files = [...contract.sources.files.filter(id => !sources.some(source => source.source_id === id)), ...fields.getAll("source").map(String)];
    if (urls.length > 8 || files.length > 6 || facts.length > 24 || facts.some(text => text.length > 600)) {
      setError("Use up to eight public links, six files, and 24 facts of up to 600 characters each."); return;
    }
    if (urls.length && !fields.has("public_search")) {
      setError("Remove the public links or allow public search."); return;
    }
    if (!!siteUrl !== !!siteGoal) {
      setError("Enter both the website address and what to capture."); return;
    }
    for (const link of [...urls, ...(siteUrl ? [siteUrl] : [])]) {
      let url: URL;
      try { url = new URL(link); }
      catch { setError(`Enter a full public link for “${link}”.`); return; }
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
        setError("Use public HTTP or HTTPS links without sign-in details."); return;
      }
    }
    setError("");
    onSave({ ...contract,
      subject: value("subject"), audience: value("audience"), purpose: value("purpose"),
      deliverable: { ...contract.deliverable, slide_count: value("slides") ? Number(value("slides")) : "auto", tone: value("tone") || undefined },
      must_include: facts.map(text => ({ text, source: "host" })),
      sources: { files, urls, materials: value("materials") || undefined, public_search: fields.has("public_search"),
        site_tasks: [...contract.sources.site_tasks.filter(task => task.mode === "interact"),
          ...(siteUrl ? [{ url: siteUrl, goal: siteGoal, mode: "read" as const }] : [])] },
    });
  };
  return <form aria-labelledby={editId} className="grid min-w-0 gap-4" onSubmit={save}>
    <h4 id={editId} className="text-sm font-semibold">Edit plan</h4>
    <fieldset disabled={busy} className="grid min-w-0 gap-3">
      <label className="grid gap-1 text-sm font-medium">Subject<Input ref={firstField} name="subject" required maxLength={600} defaultValue={contract.subject} /></label>
      <label className="grid gap-1 text-sm font-medium">Audience<Input name="audience" required maxLength={600} defaultValue={contract.audience} /></label>
      <label className="grid gap-1 text-sm font-medium">Purpose<Textarea name="purpose" required maxLength={600} defaultValue={contract.purpose} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid min-w-0 gap-1 text-sm font-medium">Slides<Input name="slides" type="number" min={1} max={MAX_PRESENTATION_SLIDES}
          placeholder="Automatic" defaultValue={contract.deliverable.slide_count === "auto" ? "" : contract.deliverable.slide_count} /></label>
        <label className="grid min-w-0 gap-1 text-sm font-medium">Tone<Input name="tone" maxLength={600} defaultValue={contract.deliverable.tone} /></label>
      </div>
      <label className="grid gap-1 text-sm font-medium">Required facts, one per line<Textarea name="facts" defaultValue={contract.must_include.map(fact => fact.text).join("\n")} /></label>
      <label className="grid gap-1 text-sm font-medium">Public links, one per line<Textarea name="urls" defaultValue={contract.sources.urls.join("\n")} /></label>
      <label className="grid gap-1 text-sm font-medium">Pasted source text<Textarea name="materials" maxLength={30000} defaultValue={contract.sources.materials} /></label>
      {!!sources.length && <fieldset className="grid gap-1">
        <legend className="text-sm font-medium">Project files</legend>
        {sources.map(source => <label key={source.source_id} className="flex min-h-11 items-center gap-2 text-sm wrap-anywhere">
          <input type="checkbox" className="size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            name="source" value={source.source_id} defaultChecked={contract.sources.files.includes(source.source_id)} />{source.filename}
        </label>)}
      </fieldset>}
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input name="public_search" type="checkbox" className="size-4 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          defaultChecked={contract.sources.public_search} />Allow public search
      </label>
      <fieldset className="grid gap-3 border-t border-border pt-3">
        <legend className="pr-2 text-sm font-medium">Public website capture</legend>
        <p className="text-sm text-muted-foreground">Optional read-only capture with no provider spend. For a signed-in task, open Website walkthrough.</p>
        <label className="grid gap-1 text-sm font-medium">Public website address<Input name="site_url" type="url" maxLength={2048} defaultValue={existingTask?.url} /></label>
        <label className="grid gap-1 text-sm font-medium">What to capture?<Input name="site_goal" maxLength={600} defaultValue={existingTask?.goal} /></label>
      </fieldset>
    </fieldset>
    {error && <p role="alert" className="text-sm text-destructive wrap-anywhere">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="submit" disabled={busy}>Save changes</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>
    </div>
  </form>;
};

const PlanSummary = ({ rows }: { rows: TPlanRow[] }) => <dl className="grid min-w-0 gap-x-5 gap-y-3 sm:grid-cols-[max-content_minmax(0,1fr)]">
  {displayRows(rows).map(({ label, values }) => <div key={label} className="min-w-0 sm:contents">
    <dt className="text-sm font-semibold">{label}</dt>
    <dd className="grid min-w-0 gap-1 text-sm text-muted-foreground wrap-anywhere">
      {values.length === 1 ? values[0] : <ul className="list-disc space-y-1 pl-4">
        {values.map((value, index) => <li key={index}>{value}</li>)}
      </ul>}
    </dd>
  </div>)}
</dl>;

const PlanChanges = ({ previous, current, from }: { previous: TPlanRow[]; current: TPlanRow[]; from: number }) => {
  const changes = current.flatMap((row, index) => {
    const prior = previous[index].values;
    return prior.length === row.values.length && prior.every((value, i) => value === row.values[i])
      ? [] : [{ label: row.label, prior, next: row.values }];
  });
  if (!changes.length) return null;
  return <div className="grid min-w-0 gap-2 border-l-2 border-primary/65 pl-3 wrap-anywhere">
    <h4 className="text-sm font-semibold">Changes from revision {from}</h4>
    <ul className="grid gap-2 text-sm">{changes.map(change => <li key={change.label}>
      <p className="font-medium">{change.label}</p>
      <p className="text-muted-foreground">Before · {change.prior.join(" · ") || "None"}</p>
      <p>Now · {change.next.join(" · ") || "None"}</p>
    </li>)}</ul>
  </div>;
};

const stepLabels: Record<TMission["steps"][number]["tool"], string> = {
  set_contract: "Presentation plan", research: "Research", browse_site: "Website capture", prepare_deck: "Slides",
  check_outcome: "Outcome check", ask_host: "Input needed", stop: "Stopped", take_over: "Manual control", resume: "Resumed",
};

const retryLabels: Record<NonNullable<TMission["retry"]>["phase"], string> = {
  research: "Retry research", preparation: "Retry slide preparation", plan: "Retry Director planning", review: "Retry Director review",
};

export const MissionPanel = ({ mission, sources, busy, approvalBlocked, error, onApprove, onRetry, onRevise, onStop, onTakeOver, onReview, onReply }: TMissionPanelProps) => {
  const { contract } = mission;
  const heading = useId();
  const [editingRevision, setEditingRevision] = useState<number | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const planning = mission.status === "needs_approval";
  const working = mission.status === "working";
  const needsInput = mission.status === "needs_input";
  const retry = needsInput ? mission.retry : null;
  const paused = mission.status === "paused";
  const reviewAvailable = !!mission.research_id && !!mission.deck_id && mission.deck_revision !== null;
  const canEdit = planning || working || needsInput || paused;
  const editing = canEdit && editingRevision === contract.revision;
  const filenames = new Map(sources.map(source => [source.source_id, source.filename]));
  const rows = planRows(contract, filenames);
  const resumed = working && mission.steps.some(step => step.tool === "resume" && step.contract_revision === contract.revision);
  const plan = <PlanSummary rows={rows} />;
  const edit = <Button ref={editButton} type="button" variant="outline" disabled={busy} onClick={() => setEditingRevision(contract.revision)}>Edit plan</Button>;
  return <Card role="region" aria-labelledby={heading} className="grid min-w-0 gap-4 bg-background p-4 sm:p-5">
    <header className="flex min-w-0 flex-wrap items-center justify-between gap-2">
      <h3 id={heading} className="flex min-w-0 items-center gap-2 text-base font-semibold"><Workflow size={17} aria-hidden="true" className="shrink-0 text-primary" />Mission</h3>
      <div role="status" className="flex flex-wrap items-center gap-2">
        <Badge variant={mission.status === "delivered" && mission.deck_id ? "default" : "secondary"}>{statusLabel(mission)}</Badge>
        {resumed && <span className="text-xs text-muted-foreground">Resumed</span>}
      </div>
    </header>
    {planning ? <div className="grid gap-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h4 className="font-semibold">Approve the presentation plan</h4>
        <span className="text-xs text-muted-foreground">Revision {contract.revision}</span>
      </div>
      {plan}
      {mission.previous_contract && <PlanChanges previous={planRows(mission.previous_contract, filenames)}
        current={rows} from={mission.previous_contract.revision} />}
    </div> : <details className="border-t border-border pt-3">
      <summary className="min-h-8 cursor-pointer text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        <ClipboardList size={15} aria-hidden="true" className="mx-1 inline-block text-primary" /> Plan · revision {contract.revision}
      </summary>
      <div className="pt-2">{plan}</div>
    </details>}
    {needsInput && <p className="flex items-start gap-2 text-sm text-foreground">
      <CircleHelp size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-primary" />{mission.gaps[0] ?? "Add what’s missing in the conversation or adjust the plan."}
    </p>}
    {(needsInput ? mission.gaps.length > 1 : mission.gaps.length > 0) && <div className="space-y-1 text-sm">
      <h4 className="font-semibold">What’s unmet</h4>
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground wrap-anywhere">{mission.gaps.slice(needsInput ? 1 : 0).map((gap, index) => <li key={index}>{gap}</li>)}</ul>
    </div>}
    {mission.steps.length > 0 && <div className="grid gap-2 border-t border-border pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="text-sm font-semibold">Activity</h4>
        <p className="text-xs text-muted-foreground">{usd.format(mission.spent_usd)} used ·
          {" "}{usd.format(Math.max(0, contract.budget.usd - mission.spent_usd - mission.reserved_usd))} available</p>
      </div>
      <ol className="grid gap-2 text-sm" aria-label="Mission activity">
        {mission.steps.map(step => <li key={step.sequence} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2 wrap-anywhere">
          <span className="mt-1.5 size-2 rounded-full bg-primary/65" aria-hidden="true" />
          <div><p className="font-medium">{stepLabels[step.tool]}</p><p className="text-muted-foreground">{step.summary}</p></div>
        </li>)}
      </ol>
    </div>}
    {editing && <div className="border-t border-border pt-3">
      <ScopeEditor contract={contract} sources={sources} busy={busy} onSave={onRevise} onCancel={() => {
        setEditingRevision(null);
        requestAnimationFrame(() => editButton.current?.focus());
      }} />
    </div>}
    {error && <p role="alert" className="text-sm text-destructive wrap-anywhere">{error}</p>}
    <div className="flex min-w-0 flex-wrap gap-2 max-[480px]:[&>button]:w-full">
      {planning && !editing && <Button type="button" disabled={busy || approvalBlocked} onClick={onApprove}><Check size={16} aria-hidden="true" />Approve plan</Button>}
      {retry && <Button type="button" disabled={busy} onClick={onRetry}>
        <RotateCcw size={16} aria-hidden="true" />{retryLabels[retry.phase]}
      </Button>}
      {needsInput && reviewAvailable && <Button type="button" variant={retry ? "outline" : "default"} disabled={busy} onClick={onReview}>
        Review presentation <ArrowRight size={16} aria-hidden="true" />
      </Button>}
      {needsInput && <Button type="button" variant={reviewAvailable || retry ? "outline" : "default"} disabled={busy} onClick={onReply}>Reply in conversation</Button>}
      {canEdit && !editing && edit}
      {working || planning || needsInput ? <>
        <Button type="button" variant="outline" disabled={busy} onClick={onStop}><Square size={14} aria-hidden="true" />Stop</Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onTakeOver}>Take over</Button>
      </> : mission.research_id && <Button type="button" disabled={busy} onClick={onReview}>
        {paused || !mission.deck_id ? "Open manual editing" : "Review presentation"} <ArrowRight size={16} aria-hidden="true" />
      </Button>}
    </div>
  </Card>;
};
