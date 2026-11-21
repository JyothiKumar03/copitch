"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Download, FileText, Mic, Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DeckWorkspace } from "@/components/deck/DeckWorkspace";
import { useBriefDictation } from "@/hooks/research/use-brief-dictation";
import { useResearch, useSavedWorkspace } from "@/hooks/research/use-research";
import { archivedPitches, saveArchivedPitches, interviewHistory, saveInterviewHistory, saveSourceSelection, restoreSourceSelection } from "@/lib/research";
import type { TInterviewMessage, TResearchWorkspace, TUploadedSource, TSavedBrief, TSourcePolicy } from "@/types/research";
import { ResearchProgress } from "./ResearchProgress";
import { ResearchMemo } from "./ResearchMemo";
import { PitchFileViewer } from "./PitchFileViewer";
import { readProgress } from "@/lib/interview";
import { VoiceInstrument } from "./VoiceInstrument";
import "./cockpit.css";

const control = "flex items-start gap-2.5 text-sm leading-5 [&_input]:mt-1 [&_input]:accent-primary";
const subhead = "font-display text-2xl font-normal tracking-tight";
const spokenConsent = (text: string) => /^(?:yes(?:,? (?:please|start (?:the )?research(?:ing)?))?|start (?:the )?research(?:ing)?|go ahead|हाँ|हां|शोध शुरू कर[ोें]*|शुरू करो)[.!।]?$/i.test(text.trim());

export const ResearchWorkspace = () => {
  const workspace = useSavedWorkspace();
  if (workspace.isError) return <div role="alert">{workspace.error.message} <Button variant="outline" onClick={() => void workspace.refetch()}>Retry</Button></div>;
  if (!workspace.data || workspace.isFetching) return <p role="status">Opening workspace…</p>;
  return <Interview initial={workspace.data} />;
};

const Interview = ({ initial }: { initial: TResearchWorkspace }) => {
  const [selectedPitch, setSelectedPitch] = useState<string | null>(null);
  const [changingScope, setChangingScope] = useState(false);
  const [readingProgress, setReadingProgress] = useState(false);
  const [progressError, setProgressError] = useState("");
  const [history, setHistory] = useState<TInterviewMessage[]>(() => initial.brief?.history?.length ? initial.brief.history : interviewHistory());
  const composer = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const artifact = useRef<HTMLElement>(null);
  useEffect(() => {
    const list = transcript.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [history]);
  const [started, setStarted] = useState(!!initial.brief || !!history.length);
  const [message, setMessage] = useState("");
  const [reviewVoice, setReviewVoice] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [canUpload, setCanUpload] = useState(initial.capabilities?.source_uploads === true);
  const [sources, setSources] = useState<TUploadedSource[]>(() => canUpload ? restoreSourceSelection(initial.brief) : initial.brief?.sources ?? []);
  const [materials, setMaterials] = useState(initial.brief?.materials ?? "");
  const [links, setLinks] = useState(initial.brief?.urls.join("\n") ?? "");
  const [policy, setPolicy] = useState<TSourcePolicy>(initial.brief?.source_policy ?? "public_search");
  const [brief, setBrief] = useState<TSavedBrief | null>(initial.brief);
  const [savedResearch, setSavedResearch] = useState(initial.research);
  const [archived, setArchived] = useState(() => initial.artifacts?.map(item => ({ researchId: item.research_id, afterTurn: item.after_turn })) ?? archivedPitches());
  const { start, upload, clarify, research, download, getSession, job } = useResearch(initial.brief?.brief_id, initial.job);
  const currentJob = job.data?.brief_id === brief?.brief_id ? job.data : research.data?.brief_id === brief?.brief_id ? research.data : undefined;
  const result = currentJob?.result ?? savedResearch;
  const resultId = result?.research_id;
  useEffect(() => {
    const pane = transcript.current;
    const response = artifact.current;
    if (!resultId || !pane || !response) return;
    pane.scrollTop = pane.scrollHeight;
  }, [resultId]);
  const running = currentJob?.status === "queued" || currentJob?.status === "running";
  const failed = currentJob?.status === "failed";
  const error = upload.error ?? start.error ?? clarify.error ?? research.error ?? download.error ?? job.error;
  const urls = policy === "public_search" ? links.trim().split(/\s+/).filter(Boolean) : [];
  const selectSources = (next: TUploadedSource[]) => {
    setSources(next); saveSourceSelection(brief?.brief_id, next);
  };
  const savedIds = brief?.source_ids ?? brief?.sources?.map(source => source.source_id) ?? [];
  const sourceIds = canUpload ? sources.map(source => source.source_id) : savedIds;
  const scopeChanged = brief && (JSON.stringify(sourceIds) !== JSON.stringify(savedIds) || policy !== brief.source_policy || materials !== brief.materials || JSON.stringify(urls) !== JSON.stringify(brief.urls));
  const canConfirm = !!brief && !brief.question && !scopeChanged && !upload.isPending && !running && !research.isPending && !clarify.isPending && !result;
  const latestTurn = history.at(-1);
  const scopeInTranscript = !!brief && latestTurn?.role === "assistant" && latestTurn.text.startsWith(brief.summary);
  const prompt = brief?.spoken_prompt ?? brief?.question ?? history.findLast(turn => turn.role === "assistant")?.text;
  const busy = start.isPending || upload.isPending || clarify.isPending || research.isPending || readingProgress;
  const [pendingVoiceReview, setPendingVoiceReview] = useState(false);
  const voice = useBriefDictation(getSession, {
    suspended: !started || busy || pendingVoiceReview || !!message.trim(),
    onFinal: (text: string) => {
      if (reviewVoice) {
        setMessage(text); setPendingVoiceReview(true);
      } else send(text);
    },
  });
  const addTurns = (...turns: TInterviewMessage[]) => {
    const next = [...history, ...turns];
    setHistory(next);
    saveInterviewHistory(next);
  };
  const begin = (firstMessage?: string) => start.mutate(undefined, { onSuccess(response) {
    const saved = response.workspace.brief;
    const acceptsUploads = response.workspace.capabilities?.source_uploads === true;
    setCanUpload(acceptsUploads);
    setBrief(saved);
    if (saved) {
      setSources(acceptsUploads ? restoreSourceSelection(saved) : saved.sources ?? []);
      setPolicy(saved.source_policy);
      setMaterials(saved.materials);
      setLinks(saved.urls.join("\n"));
    }
    setSavedResearch(response.workspace.research); setStarted(true);
    if (saved?.history?.length) {
      setHistory(saved.history); saveInterviewHistory(saved.history);
    } else addTurns({ role: "assistant", text: response.greeting });
    if (firstMessage?.trim()) send(firstMessage);
    else { void voice.setHandsFree(true); void voice.readQuestion(saved?.spoken_prompt ?? response.greeting); }
  } });
  const confirm = (text: string) => {
    if (!brief || !canConfirm) return;
    voice.stopPlayback();
    research.mutate({ briefId: brief.brief_id, retry: failed, approvalText: text }, { onSuccess(accepted) {
      setMessage(""); setPendingVoiceReview(false);
      setHistory(accepted.history); saveInterviewHistory(accepted.history);
    } });
  };
  const send = (text: string, replaceRunningScope = false) => {
    const content = text.trim();
    if (!content || busy) return;
    if (currentJob && !replaceRunningScope && (running || /(?:progress|status|how (?:far|long|is .*going)|any (?:updates?|news)|are (?:we|you) (?:done|still)|is it ready|प्रगति|कितना|स्थिति|कहाँ तक|अपडेट|कहां तक|कितनी|हो गया)/iu.test(content))) {
      setProgressError(""); setReadingProgress(true); setMessage(""); setPendingVoiceReview(false);
      void getSession().then(session => readProgress(session, currentJob.job_id, content)).then(reply => {
        addTurns({ role: "host", text: content }, { role: "assistant", text: reply.text });
        void voice.readQuestion(reply.text, reply.turnId);
      }).catch(() => setProgressError("Research progress is unavailable. Please try again."))
        .finally(() => setReadingProgress(false));
      return;
    }
    if (canConfirm && spokenConsent(content)) { confirm(content); return; }
    voice.stopPlayback(); setPendingVoiceReview(false); setMessage(content);
    clarify.mutate({ message: content, source_policy: policy, materials, urls, ...(canUpload && { source_ids: sourceIds }), ...(brief && { brief_id: brief.brief_id }) }, {
      onSuccess(next) {
        setChangingScope(false);
        const reply = next.spoken_prompt ?? next.question ?? "The scope is ready. Should I start researching?";
        if (result && !archived.some(item => item.researchId === result.research_id)) {
          const items = [...archived, { researchId: result.research_id, afterTurn: Math.max(0, history.length - 1) }];
          setArchived(items); saveArchivedPitches(items);
        }
        setBrief({ ...next, materials, source_ids: sourceIds, sources, source_policy: policy, urls }); setSavedResearch(null); setMessage("");
        if (next.history?.length) { setHistory(next.history); saveInterviewHistory(next.history); }
        else addTurns({ role: "host", text: content }, { role: "assistant", text: reply });
        if (next.spoken_prompt) void voice.readQuestion(next.spoken_prompt);
      },
    });
  };

  const sourcePanel = (
    <details className="group border-t border-border py-5">
      <summary className="cursor-pointer list-none text-base font-semibold">Research sources <span aria-hidden="true" className="float-right text-muted-foreground group-open:rotate-45">+</span><span className="mt-1 block text-sm font-normal text-muted-foreground">{policy === "files_only" ? "Your materials only" : "Your materials and public research"}</span></summary>
      <fieldset className="mt-4 space-y-4" disabled={busy}><legend className="sr-only">Research sources</legend>
        <div className="grid gap-2">
          <label className={control}><input type="radio" name="policy" checked={policy === "files_only"} onChange={() => setPolicy("files_only")} /> My materials only</label>
          <label className={control}><input type="radio" name="policy" checked={policy === "public_search"} onChange={() => setPolicy("public_search")} /> Include public research</label>
        </div>
        {canUpload && <>
          <label className="mb-3 block">Attach a PDF, PPTX, or CSV
            <Input className="mt-2 w-full min-w-0 cursor-pointer text-xs" type="file" disabled={sources.length >= 6} accept=".pdf,.pptx,.csv" onChange={event => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              upload.reset(); setUploadError("");
              if (file.size > 8 * 1024 * 1024 || !/\.(pdf|pptx|csv)$/i.test(file.name)) {
                setUploadError("Choose a PDF, PPTX, or CSV up to 8 MiB."); return;
              }
              upload.mutate(file, { onSuccess(source) {
                selectSources([...sources.filter(item => item.source_id !== source.source_id), source]);
              } });
            }} />
          </label>
          <p className="mb-2 text-xs text-muted-foreground">Up to 6 files, 8 MiB per file.</p>
          {upload.isPending && <p role="status">Reading attachment…</p>}
        </>}
        {!!sources.length && <ul className="mb-4 space-y-2">{sources.map(source => <li key={source.source_id} className="flex items-baseline justify-between gap-3 text-sm">
          <span className="break-all">{source.filename} <span className="text-muted-foreground">· {source.locations} source location{source.locations === 1 ? "" : "s"}</span></span>{canUpload && <button className="underline" type="button" aria-label={"Remove " + source.filename} onClick={() => selectSources(sources.filter(item => item.source_id !== source.source_id))}>Remove</button>}
        </li>)}</ul>}
        <label className="block">Source material<Textarea className="mt-2" rows={4} maxLength={30000} placeholder="Paste excerpts with source names and dates." value={materials} onChange={event => setMaterials(event.target.value)} /></label>
        {policy === "public_search" && <label className="mt-3 block">Public URLs<Textarea className="mt-2" rows={2} placeholder="One URL per line" value={links} onChange={event => setLinks(event.target.value)} /></label>}
      </fieldset>
    </details>
  );
  const instrumentState = voice.phase === "requesting" || start.isPending ? "connecting" :
    voice.phase === "recording" ? "recording" : voice.phase === "transcribing" ? "transcribing" :
    voice.speaking ? "speaking" : clarify.isPending ? "thinking" : running ? "researching" :
    voice.handsFree && !message.trim() && !pendingVoiceReview ? "listening" : result ? "complete" : "ready";
  const archivedAt = (index: number) => archived.filter(item => item.researchId !== result?.research_id &&
    Math.min(item.afterTurn, history.length - 1) === index);

  return (
    <div className="studio-cockpit">
      <section className="cockpit-agent min-w-0" aria-label="Agent and microphone controls">
        <VoiceInstrument state={instrumentState} />
        <div className="flex flex-wrap items-center gap-2 border-x border-b border-border bg-card p-3">
          {!started ? <Button type="button" disabled={busy} onClick={() => begin()}><Mic size={16} aria-hidden="true" />Start voice conversation</Button> : <>
            <Button type="button" variant="outline" onClick={() => void voice.setHandsFree(!voice.handsFree)}>
              {voice.handsFree ? <Square size={15} /> : <Mic size={15} />}{voice.handsFree ? "End voice" : "Start voice"}
            </Button>
          {voice.speaking && <Button type="button" variant="outline" onClick={voice.stopPlayback}>Stop reply</Button>}
          </>}
        </div>
      </section>
      <aside className="cockpit-settings min-w-0" aria-label="Activity and session settings">
        <ResearchProgress job={currentJob} />
        {running && <Button variant="outline" size="sm" onClick={() => { setChangingScope(!changingScope); composer.current?.focus(); }}>
          {changingScope ? "Keep current scope" : "Change research scope"}
        </Button>}
        <details className="group border-b border-border py-4">
          <summary className="cursor-pointer list-none font-medium">Voice settings <span aria-hidden="true" className="float-right group-open:rotate-45">+</span></summary>
          <div className="space-y-4 border-t border-border py-5">
            <h3 className="sr-only">Voice</h3>
            <label className={control}><input type="checkbox" checked={voice.voiceEnabled} onChange={event => {
              voice.enableVoice(event.target.checked); if (event.target.checked && prompt) void voice.readQuestion(prompt);
            }} /> Hear the AI’s replies aloud</label>
            {started && <>
              {voice.handsFree && <p role="status" className="text-sm text-muted-foreground">{pendingVoiceReview ? "Review your message and choose Send to confirm." : "Pause to finish your turn. Speak to interrupt the AI."}</p>}
              {!voice.handsFree && <Button size="sm" variant="outline" type="button" disabled={busy || voice.phase === "requesting" || voice.phase === "transcribing"}
                onClick={() => void voice.dictate(text => { if (reviewVoice) setMessage(text); else send(text); })}>
                {voice.phase === "recording" ? "Finish recording" : "Record one message"}
              </Button>}
              <label className={control}><input type="checkbox" checked={reviewVoice} disabled={voice.phase !== "idle"} onChange={event => setReviewVoice(event.target.checked)} /> Review transcripts before sending</label>
              {voice.voiceEnabled && prompt && <button className="text-sm underline underline-offset-4" onClick={() => void voice.readQuestion(prompt)}>Replay latest prompt</button>}
              <p className="text-xs leading-relaxed text-muted-foreground">Allow microphone access to speak. You can also type at any time.</p>
            </>}
          </div>

        </details>

      </aside>
      <section aria-label="Private conversation" className="cockpit-chat min-w-0 border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-7">
          <h2 className="font-display text-2xl">Conversation</h2>
          {started && <span className="text-xs text-muted-foreground">Private session</span>}
        </div>
        {[error?.message, uploadError, voice.error, progressError].filter(Boolean).map((text, index) =>
          <p key={index} role="alert" className="border-l-2 border-destructive px-5 py-3 text-sm text-destructive">{text}</p>)}
        <div ref={transcript} tabIndex={0} aria-label="Conversation timeline" className="conversation-timeline">
        {!started ? <div className="space-y-3 px-5 py-7 sm:px-7 sm:py-9">
          <span className="text-xs font-semibold text-primary">copitch</span>
          <h3 className="max-w-[15ch] font-display text-4xl font-normal leading-[1.05] tracking-tight sm:text-5xl">What are you pitching?</h3>
          <p className="max-w-md text-muted-foreground">Describe your idea and audience. You’ll review the scope before research starts.</p>
        </div> : <>
          <ol aria-label="Conversation messages" aria-live="polite" className="space-y-5 px-5 py-6 sm:px-7">
            {history.map((turn, index) => <Fragment key={index}><li className={turn.role === "host" ? "ml-auto w-fit max-w-[92%] rounded-2xl rounded-br-sm bg-accent/55 px-4 py-3" : "max-w-[96%]"}>
              <span className="mb-1 block text-xs font-semibold text-primary">{turn.role === "host" ? "You" : "copitch"}</span>
              <p className="whitespace-pre-wrap break-words leading-relaxed">{turn.text}</p>
            </li>{archivedAt(index).map(item => <li key={item.researchId}>
              <Button variant="outline" onClick={() => setSelectedPitch(item.researchId)}><FileText size={16} />Earlier pitch.md</Button>
            </li>)}</Fragment>)}
            {!history.length && brief && <li><span className="text-xs font-semibold text-primary">copitch</span><p>{brief.spoken_prompt ?? brief.question ?? brief.summary}</p></li>}
          </ol>
            {brief && !result && <section className="space-y-3 border-t border-border bg-accent/35 px-5 py-5 sm:px-7">
              <h2 className={subhead}>Research scope</h2>
              {!scopeInTranscript && <p className="leading-relaxed">{brief.summary}</p>}
              <p className="text-sm text-muted-foreground">{brief.source_policy === "files_only" ? "Use my materials only." : "Include public research."}</p>
              {!!brief.sources?.length && <p className="break-words text-sm">Attached sources: {brief.sources.map(source => source.filename).join(", ")}</p>}
              {brief.source_policy === "public_search" && !!brief.urls.length && <div><h3 className="text-sm font-semibold">Requested pages</h3><ul className="mt-1 list-disc pl-5">{brief.urls.map((url, i) => <li className="break-all" key={i}>{url}</li>)}</ul></div>}
              {!!brief.public_queries.length && <div><h3 className="text-sm font-semibold">Proposed public searches</h3><ul className="mt-1 list-disc pl-5">{brief.public_queries.map((query, i) => <li key={i}>{query}</li>)}</ul></div>}
              {failed && <p role="alert" className="text-destructive">{currentJob.error ?? "Research failed. Retry or refine the brief."}</p>}
              {canConfirm && <Button disabled={voice.phase !== "idle" || !!message.trim()} onClick={() => confirm(failed ? "Retry research." : "Start researching.")}>{failed ? "Retry research" : "Start researching"}</Button>}
            </section>}

          {result && <section ref={artifact} aria-label="Pitch response" className="space-y-5 border-t border-border p-5 sm:p-7">
            <div className="flex justify-end"><button type="button" className="text-sm text-primary underline underline-offset-4"
              onClick={() => composer.current?.focus()}>Request a revision ↓</button></div>
            <Button variant="outline" onClick={() => setSelectedPitch(result.research_id)} aria-haspopup="dialog"><FileText size={16} />pitch.md</Button>
            <details className="border-y border-border py-5">
              <summary className="cursor-pointer font-medium">Research memo and sources</summary>
              <div className="my-6"><ResearchMemo markdown={result.markdown} /></div>
              {!!result.gaps.length && <><h3 className={subhead}>Evidence gaps</h3><ul className="my-4 list-disc space-y-1 pl-5">{result.gaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul></>}
              <Button variant="outline" disabled={download.isPending} onClick={() => download.mutate(result.research_id)}><Download size={16} aria-hidden="true" />Download memo</Button>
            </details>
            <details className="border-y border-border py-4"><summary className="cursor-pointer font-medium">Presentation options</summary>
              <div className="mt-4"><DeckWorkspace key={result.research_id} researchId={result.research_id} getSession={getSession} /></div>
            </details>
          </section>}
        </>}
        </div>
        <div className="px-5 sm:px-7">{sourcePanel}</div>
        <form className="space-y-2 border-t border-border bg-card p-4 sm:px-7" onSubmit={event => {
          event.preventDefault();
          const text = message.trim() || (scopeChanged ? "Update the research sources." : "");
          if (!busy && text) { if (started) send(text, changingScope && running); else begin(text); }
        }}>
                <label className="block text-sm font-medium">Your message
                  <Textarea ref={composer} className="mt-1.5 min-h-16" disabled={busy} rows={2} maxLength={6000} value={message} placeholder={result ? "Ask for a revision or give your next instruction…" : "Type a message or start voice…"} onChange={event => { setMessage(event.target.value); if (!event.target.value.trim()) setPendingVoiceReview(false); }} />
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" className="ml-auto" disabled={(!message.trim() && !scopeChanged) || busy}>{clarify.isPending ? "Thinking…" : changingScope && running ? "Replace running scope" : scopeChanged && !message.trim() ? "Update scope" : "Send"}<Send size={15} aria-hidden="true" /></Button>
                </div>
        </form>
      </section>
      {selectedPitch && <PitchFileViewer researchId={selectedPitch} getSession={getSession} onClose={() => setSelectedPitch(null)} />}
    </div>
  );
};
