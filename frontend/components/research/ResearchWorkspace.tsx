"use client";

import { useState, type FormEvent } from "react";
import { ResearchMemo } from "./ResearchMemo";
import { useResearch } from "@/hooks/research/use-research";
import type { TResearchBrief, TSourcePolicy } from "@/types/research";

const field = "mt-2 block w-full rounded-xl border border-input bg-background p-3 text-sm focus-visible:outline-ring";
const button = "rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50";
const secondary = "rounded-xl border border-input px-4 py-2.5 text-sm hover:border-ring disabled:opacity-50";

export function ResearchWorkspace() {
  const [message, setMessage] = useState("");
  const [materials, setMaterials] = useState("");
  const [links, setLinks] = useState("");
  const [policy, setPolicy] = useState<TSourcePolicy>("files_only");
  const [brief, setBrief] = useState<TResearchBrief | null>(null);
  const [review, setReview] = useState(false);
  const { clarify, research, download } = useResearch();
  const result = research.data;
  const error = download.error ?? research.error ?? clarify.error;

  async function handleBrief(event: FormEvent) {
    event.preventDefault();
    if (!message.trim() || clarify.isPending) return;
    research.reset();
    const urls = policy === "public_search" ? links.split(/\s+/).filter(Boolean) : [];
    clarify.mutate({
      message: message.trim(),
      source_policy: policy,
      materials,
      urls,
      ...(brief && { brief_id: brief.brief_id }),
    }, {
      onSuccess(next) {
        setBrief(next);
        setReview(true);
      },
    });
  }

  function editBrief() {
    setMessage("");
    setReview(false);
    research.reset();
  }

  return (
    <div className="space-y-6">
      {error && <p role="alert" className="rounded-xl border border-rose-900 p-3 text-rose-200">{error.message}</p>}
      {result ? (
        <section className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-semibold">Research memo</h2>
            <button className={button} disabled={download.isPending} onClick={() => download.mutate(result.research_id)}>
              {download.isPending ? "Downloading…" : "Download presentation.md"}
            </button>
          </div>
          <ResearchMemo markdown={result.markdown} />
          {result.gaps.length > 0 && <section>
            <h3 className="font-semibold">Evidence gaps</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5">{result.gaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul>
          </section>}
          <button className={secondary} onClick={editBrief}>Refine the brief</button>
        </section>
      ) : review && brief ? (
        <section className="space-y-5 rounded-xl border border-input p-5">
          <h2 className="text-xl font-semibold">Review research scope</h2>
          <p className="whitespace-pre-wrap">{brief.summary}</p>
          <p className="text-sm text-slate-300">{policy === "files_only" ? "Sources limited to your supplied material." : "Public research allowed."}</p>
          {brief.public_queries.length > 0 && <section>
            <h3 className="font-semibold">Public search queries</h3>
            <ul className="list-disc pl-5">{brief.public_queries.map((query, i) => <li key={i}>{query}</li>)}</ul>
          </section>}
          {brief.question && <p className="rounded-xl bg-slate-800 p-3">{brief.question}</p>}
          <div className="flex flex-wrap gap-3">
            <button className={secondary} disabled={research.isPending} onClick={editBrief}>{brief.question ? "Answer follow-up" : "Edit brief"}</button>
            <button className={button} disabled={research.isPending || Boolean(brief.question)} onClick={() => research.mutate(brief.brief_id)}>
              {research.isPending ? "Researching…" : "Confirm and research"}
            </button>
          </div>
        </section>
      ) : (
        <form className="space-y-5" onSubmit={handleBrief}>
          {brief && <p className="whitespace-pre-wrap text-slate-300">{brief.question || brief.summary}</p>}
          <label className="block font-medium">
            {brief ? "Your answer or correction" : "What are you presenting, and who will be listening?"}
            <textarea className={field} rows={4} value={message} onChange={e => setMessage(e.target.value)} required />
          </label>
          <fieldset>
            <legend className="mb-2 font-medium">Research sources</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              <label><input type="radio" name="policy" checked={policy === "files_only"} onChange={() => setPolicy("files_only")} /> My materials only</label>
              <label><input type="radio" name="policy" checked={policy === "public_search"} onChange={() => setPolicy("public_search")} /> Include public research</label>
            </div>
          </fieldset>
          <label className="block font-medium">Source material
            <textarea className={field} rows={5} placeholder="Paste excerpts with the source name, date and page when available." value={materials} onChange={e => setMaterials(e.target.value)} />
          </label>
          {policy === "public_search" && <label className="block font-medium">Public URLs
            <textarea className={field} rows={2} placeholder="One URL per line" value={links} onChange={e => setLinks(e.target.value)} />
          </label>}
          <button className={button} disabled={!message.trim() || clarify.isPending}>{clarify.isPending ? "Preparing scope…" : "Review research scope"}</button>
        </form>
      )}
    </div>
  );
}
