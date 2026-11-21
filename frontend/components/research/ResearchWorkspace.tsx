"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { ArrowUpRight, ChevronDown, FileText, LockKeyhole, MessageSquare, Volume2, VolumeX, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { DeckWorkspace } from "@/components/deck/DeckWorkspace";
import { useVoiceAgent } from "@/hooks/research/use-voice-agent";
import { useStudioEvents } from "@/hooks/research/use-studio-events";
import { useResearch, useSavedWorkspace } from "@/hooks/research/use-research";
import { savedSession, restoreSourceSelection, saveSourceSelection } from "@/lib/research";
import type { TInterviewMessage, TProposalChoice, TResearchProposal, TResearchWorkspace, TSourcePolicy, TTurnInput, TUploadedSource } from "@/types/research";
import { ResearchProgress, SourceExecution, TurnExecution } from "./ResearchProgress";
import { ContextFileViewer } from "./ContextFileViewer";
import { StudioQuestion } from "./StudioQuestion";
import { liveCaption } from "@/lib/voice-preview";
import { StudioComposer } from "./StudioComposer";
import { VoiceInstrument } from "./VoiceInstrument";
import "./cockpit.css";

export const ResearchWorkspace = () => {
  const workspace = useSavedWorkspace();
  if (workspace.isError && !workspace.data) return <div role="alert">{workspace.error.message} <Button variant="outline" onClick={() => void workspace.refetch()}>Retry</Button></div>;
  if (!workspace.data) return <p role="status">Opening workspace…</p>;
  return <Interview initial={workspace.data} />;
};

const ContextButton = ({ onOpen, earlier = false }: { onOpen: () => void; earlier?: boolean }) => (
  <button type="button" onClick={onOpen} aria-haspopup="dialog" className="pitch-file" aria-label={earlier ? "Earlier context.md" : "context.md"}>
    <span className="pitch-icon"><FileText size={21} /></span>
    <span className="min-w-0 flex-1"><strong>context.md</strong><small>{earlier ? "Earlier context" : "Open saved context"}</small></span><ArrowUpRight size={17} />
  </button>
);

const turnBody = (turn: TInterviewMessage, proposal?: TResearchProposal | null, proposalTurn?: string | null) => {
  if (!proposal || turn.role !== "assistant" || !proposalTurn || proposalTurn !== turn.turn_id) return turn.text;
  const listed = new Set([proposal.summary, proposal.urls.join(", ")]);
  return turn.text.split(/\n\s*\n/).filter(line => !listed.has(line.trim())).join("\n\n");
};

const sameUrls = (left: string[], right: string[]) => {
  const normalize = (url: string) => { try { return new URL(url).href; } catch { return url; } };
  return JSON.stringify(left.map(normalize)) === JSON.stringify(right.map(normalize));
};

const Interview = ({ initial }: { initial: TResearchWorkspace }) => {
  const workspace = initial;
  const client = useQueryClient();
  const session = savedSession();
  useStudioEvents(session);
  const [message, setMessage] = useState("");
  const [sources, setSources] = useState<TUploadedSource[]>(() => {
    const selected = initial.state?.source_ids;
    const files = initial.sources?.filter(source => !selected || selected.includes(source.source_id));
    return restoreSourceSelection(initial.brief, files);
  });
  const savedMaterials = workspace.state?.materials ?? workspace.context?.materials ?? workspace.brief?.materials ?? "";
  const savedUrls = workspace.state?.urls ?? workspace.proposal?.urls ?? workspace.context?.entities?.urls ?? workspace.brief?.urls ?? [];
  const savedPolicy = workspace.state?.source_policy ?? workspace.proposal?.source_policy ?? workspace.context?.source_policy ?? workspace.brief?.source_policy ?? "public_search";
  const [draftMaterials, setMaterials] = useState<string | null>(null);
  const [draftUrls, setUrls] = useState<string[] | null>(null);
  const [draftPolicy, setPolicy] = useState<TSourcePolicy | null>(null);
  const materials = draftMaterials ?? savedMaterials;
  const urls = draftUrls ?? savedUrls;
  const policy = draftPolicy ?? savedPolicy;
  const [voiceTurn, setVoiceTurn] = useState<{ speaker: "host" | "agent"; text: string; id: string; final: boolean } | null>(null);
  const [pending, setPending] = useState<TTurnInput | null>(null);
  const [failedTurn, setFailedTurn] = useState<TTurnInput | null>(null);
  const [notice, setNotice] = useState("");
  const applyButton = useRef<HTMLButtonElement>(null);
  const [greeting, setGreeting] = useState("");
  const [selectedContext, setSelectedContext] = useState<string | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const sending = useRef(false);
  const parsing = useRef(false);
  const brief = workspace.brief;
  const history = workspace.history ?? brief?.history ?? [];
  const service = useResearch(savedSession()?.session_id ?? "", workspace.job);
  const job = service.job.data ?? workspace.job;
  const running = job?.status === "running" || job?.status === "queued";
  const unsuccessful = job?.status === "needs_input" || job?.status === "failed" || job?.status === "superseded";
  const result = job ? (unsuccessful || running ? null : job.result ?? workspace.research) : workspace.research;
  const archived = (workspace.artifacts ?? []).filter(item => item.research_id !== result?.research_id);
  const calls = service.calls.data ?? [];
  const selectSources = (next: TUploadedSource[]) => { setSources(next); saveSourceSelection(brief?.brief_id, next); };
  const savedIds = workspace.state?.source_ids ?? brief?.source_ids ?? brief?.sources?.map(source => source.source_id) ?? [];
  const changedScope = policy !== savedPolicy || materials !== savedMaterials ||
    !sameUrls(urls, savedUrls) || JSON.stringify(sources.map(s => s.source_id)) !== JSON.stringify(savedIds);
  const proposal = workspace.phase === "proposed" ? workspace.proposal : null;
  const voice = useVoiceAgent(service.getSession, { onVoiceTurn: setVoiceTurn });
  const submit = (text: string, choice?: TProposalChoice) => {
    if (!text.trim() || sending.current || parsing.current || service.applySources.isPending) return;
    const payload: TTurnInput = { turn_id: crypto.randomUUID(), message: text.trim(), input: "typed",
      ...(choice && proposal && { answer_to: proposal.proposal_id, option_id: choice }),
      ...(brief && { brief_id: brief.brief_id }), source_policy: policy, materials, urls, source_ids: sources.map(s => s.source_id) };
    execute(payload);
  };
  const execute = (payload: TTurnInput) => {
    if (sending.current) return;
    sending.current = true;
    setFailedTurn(null); setNotice(""); setPending(payload);
    if (payload.input === "typed" && message.trim() === payload.message) setMessage("");
    service.turn.mutate(payload, {
      onSuccess(reply) {
        const next = reply.workspace;
        client.setQueryData(["host-workspace", session?.session_id], next);
        if (payload.option_id) composer.current?.focus();
        if (next.state?.source_policy === payload.source_policy) setPolicy(current => current === payload.source_policy ? null : current);
        if (next.state?.materials === payload.materials) setMaterials(current => current === payload.materials ? null : current);
        if (payload.urls && next.state?.urls && sameUrls(payload.urls, next.state.urls)) {
          setUrls(current => current && sameUrls(current, payload.urls ?? []) ? null : current);
        }
        saveSourceSelection(next.brief?.brief_id, sources);
        // Research started from the button: the voice conversation is over.
        if (voice.handsFree && next.job && next.job.job_id !== workspace.job?.job_id) void voice.setHandsFree(false);
      },
      onError(error) {
        if ("status" in error && error.status === 409) {
          if (!payload.option_id) setMessage(payload.message);
          void client.invalidateQueries({ queryKey: ["host-workspace", session?.session_id] });
        } else setFailedTurn(payload);
        setNotice("status" in error && error.status === 409 ? "The conversation changed. Review the current plan before sending again." : error.message);
      },
      onSettled() { sending.current = false; setPending(null); },
    });
  };
  const applySources = () => {
    if (!changedScope || running || parsing.current || sending.current || service.applySources.isPending) return;
    setNotice("");
    const scope = { source_ids: sources.map(source => source.source_id), source_policy: policy, materials, urls,
      expected_proposal_id: proposal?.proposal_id ?? null };
    service.applySources.mutate(scope, {
      onSuccess(next) {
        client.setQueryData(["host-workspace", session?.session_id], next);
        setPolicy(current => current === scope.source_policy ? null : current);
        setMaterials(current => current === scope.materials ? null : current);
        setUrls(current => current && sameUrls(current, scope.urls) ? null : current);
        saveSourceSelection(next.brief?.brief_id, sources);
        composer.current?.focus();
      },
      onError(error) {
        setNotice(error.message);
        if ("status" in error && error.status === 409) void client.invalidateQueries({ queryKey: ["host-workspace", session?.session_id] });
      },
    });
  };
  const toggleVoice = () => {
    if (!voice.handsFree && !running && (changedScope || service.applySources.isPending || service.upload.isPending)) {
      setNotice("Apply your source changes before starting voice.");
      applyButton.current?.focus();
      return;
    }
    if (voice.handsFree) { void voice.setHandsFree(false); return; }
    setVoiceTurn(null);
    void voice.setHandsFree(true);
    if (!history.length && !greeting && !service.start.isPending) service.start.mutate(undefined, { onSuccess(reply) { setGreeting(reply.greeting); } });
  };
  const instrument = voice.phase === "requesting" ? "connecting" : voice.phase === "recording" ? "recording" :
    voice.phase === "transcribing" ? "transcribing" : voice.speaking ? "speaking" : pending ? "thinking" :
    voice.handsFree ? "listening" : running ? "researching" : result ? "complete" : "ready";

  const attachFiles = async (files: File[]) => {
    if (!files.length || parsing.current || sending.current) return;
    if (files.length + sources.length > 6) { setNotice("Choose up to six files per brief."); return; }
    parsing.current = true;
    const accepted = [...sources];
    const errors: string[] = [];
    for (const file of files) {
      if (!/\.(pdf|pptx?|csv)$/i.test(file.name) || file.size > 8 * 1024 * 1024) { errors.push(file.name + " needs to be a PDF, PowerPoint or CSV file under 8 MiB."); continue; }
      try {
        const source = await service.upload.mutateAsync(file);
        if (!accepted.some(s => s.source_id === source.source_id)) accepted.push(source);
        selectSources([...accepted]);
      } catch (error) { errors.push(error instanceof Error ? error.message : "Could not read " + file.name); }
      finally { void service.calls.refetch(); }
    }
    parsing.current = false; setNotice(errors.join(" ")); composer.current?.focus();
  };
  const attachUrl = (value: string) => {
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || value.length > 2048) throw Error();
      if (!urls.includes(value)) {
        if (urls.length >= 8) { setNotice("Use up to eight public URLs in a brief."); return; }
        setUrls([...urls, value]);
      }
      setNotice("");
    } catch { setNotice("Paste a complete HTTP or HTTPS link without credentials."); }
  };
  const attachText = (text: string) => {
    const value = [materials, text].filter(Boolean).join("\n\n");
    if (value.length > 30000) { setNotice("Use up to 30,000 characters of pasted source material."); return; }
    setMaterials(value); setNotice("");
  };
  const previewTurn = voice.handsFree ? liveCaption(history, voiceTurn) : null;
  const approvalIndex = history.findLastIndex(turn => turn.role === "assistant" &&
    (turn.intent === "start_research" || turn.option_id === "approve" || turn.intent === "approval" || /researching the scope you approved/i.test(turn.text)));
  const stepIndex = approvalIndex >= 0 ? approvalIndex : history.length - 1;
  const callIndex = (time: string) => {
    const nextTurn = history.findIndex(turn => turn.created_at != null && turn.created_at >= Date.parse(time));
    return nextTurn === -1 ? history.length : nextTurn;
  };
  const scrollKey = [history.length, pending?.turn_id, calls.length, job?.activity?.length, result?.research_id, previewTurn?.id].join("-");
  useEffect(() => {
    const pane = transcript.current;
    if (pane) pane.scrollTop = pane.scrollHeight;
  }, [scrollKey]);

  const error = notice || service.start.error?.message || voice.error || service.job.error?.message;
  const canSend = !!message.trim() && !pending && !service.upload.isPending && !service.applySources.isPending;
  return <div className="studio-cockpit">
    <section className="cockpit-chat" aria-label="Private conversation">
      <header className="chat-heading"><div><MessageSquare size={16} aria-hidden="true" /><h2>Conversation</h2></div><span><LockKeyhole size={12} />Private</span></header>
      <div className="conversation-timeline" ref={transcript} tabIndex={0} aria-label="Conversation timeline">
        {!history.length && !previewTurn && <div className="chat-opening"><span>copitch</span><h3>{greeting || "What do you want to pitch?"}</h3></div>}
        <div className="chat-turns" role="log" aria-relevant="additions" aria-live="polite" aria-label="Conversation messages">
          {history.map((turn, index) => {
            const body = turnBody(turn, proposal, workspace.state?.proposal_turn_id);
            return <Fragment key={(turn.turn_id ?? index) + turn.role}>
            {calls.filter(call => callIndex(call.started_at) === index).map(call => <SourceExecution key={call.call_id} call={call} />)}
            {body && <div className={"chat-turn " + turn.role}><small>{turn.role === "host" ? "You" : "copitch"}</small><p>{body}</p></div>}
            {turn.role === "assistant" && workspace.activities?.filter(activity => activity.turn_id === turn.turn_id && activity.tool !== "ask_input").map((activity,i) =>
              <TurnExecution key={i} activity={activity} />)}
            {job && index === stepIndex && <ResearchProgress job={job} />}
            {archived.filter(item => Math.min(item.after_turn, history.length - 1) === index).map(item =>
              <ContextButton key={item.research_id} earlier onOpen={() => setSelectedContext(item.research_id)} />)}
          </Fragment>;})}
          {calls.filter(call => callIndex(call.started_at) === history.length).map(call => <SourceExecution key={call.call_id} call={call} />)}
          {!history.length && job && <ResearchProgress job={job} />}
          {pending && !history.some(turn => turn.turn_id === pending.turn_id) && <div className="chat-turn host pending" aria-hidden="true"><small>You</small><p>{pending.message}</p></div>}
          {pending && <div className="chat-pending" role="status">copitch is replying<span aria-hidden="true">…</span></div>}
          {previewTurn && <div className={"chat-turn " + (previewTurn.speaker === "host" ? "host" : "assistant")} aria-live="off"><small>{previewTurn.speaker === "host" ? "You" : "copitch"}</small><p>{previewTurn.text}</p></div>}
          {proposal && <StudioQuestion proposal={proposal} filenames={(workspace.sources ?? brief?.sources ?? []).filter(source => savedIds.includes(source.source_id)).map(source => source.filename)} changed={changedScope}
            busy={!!pending || service.upload.isPending || service.applySources.isPending} onChoose={(choice,label) => submit(label, choice)} />}
          {result && <div aria-label="Research result" className="pitch-response">
            <ContextButton onOpen={() => setSelectedContext(result.research_id)} />
            <details className="result-details"><summary>Presentation options <ChevronDown size={14} /></summary><DeckWorkspace key={result.research_id} researchId={result.research_id} getSession={service.getSession} /></details>
          </div>}
        </div>
      </div>
      {error && <div role="alert" className="chat-error"><span>{error}</span>
        {failedTurn && <button onClick={() => execute(failedTurn)}>Retry message</button>}
        {notice && <button aria-label="Dismiss notice" onClick={() => setNotice("")}><X size={14} /></button>}</div>}
      {changedScope && <div className="source-changes">
        <span>{running ? "Apply source changes after this research finishes." : voice.handsFree ? "Voice uses the saved sources until you apply these changes." :
          proposal ? "Applying source changes will reopen this plan." : "Apply these sources to use them in voice."}</span>
        <Button type="button" ref={applyButton} variant="outline" size="sm" disabled={running || !!pending || service.applySources.isPending || service.upload.isPending}
          onClick={applySources}>{service.applySources.isPending ? "Applying…" : "Apply sources"}</Button>
      </div>}
      <StudioComposer inputRef={composer} message={message} setMessage={setMessage} sources={sources} urls={urls} materials={materials}
        policy={policy} setPolicy={setPolicy} canSend={canSend} sending={!!pending} uploading={service.upload.isPending}
        attachFiles={files => void attachFiles(files)} attachUrl={attachUrl} attachText={attachText} removeFile={id => selectSources(sources.filter(s => s.source_id !== id))}
        removeUrl={url => setUrls(urls.filter(item => item !== url))} removeText={() => setMaterials("")}
        voiceActive={voice.handsFree} toggleVoice={toggleVoice} submit={() => submit(message)} />
    </section>
    <aside className="cockpit-agent" aria-label="Agent and microphone controls"><VoiceInstrument state={instrument} />
      <div className="agent-settings"><span>Spoken replies</span><button type="button" aria-pressed={voice.voiceEnabled} onClick={() => voice.enableVoice(!voice.voiceEnabled)}>
        {voice.voiceEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}{voice.voiceEnabled ? "On" : "Off"}</button></div>
    </aside>
    {selectedContext && <ContextFileViewer key={selectedContext} project={session?.session_id ?? ""} researchId={selectedContext} getSession={service.getSession} onClose={() => setSelectedContext(null)} />}
  </div>;
};
