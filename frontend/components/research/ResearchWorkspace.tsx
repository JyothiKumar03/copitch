"use client";

import { Fragment, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, AudioLines, CircleAlert, LoaderCircle, LockKeyhole, MessageSquare, Mic, Presentation, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DeckWorkspace } from "@/components/deck/DeckWorkspace";
import { useVoiceAgent } from "@/hooks/research/use-voice-agent";
import { useStudioEvents } from "@/hooks/research/use-studio-events";
import { useResearch, useSavedWorkspace } from "@/hooks/research/use-research";
import { savedSession, restoreSourceSelection, saveSourceSelection } from "@/lib/research";
import type { TInterviewMessage, TProposalChoice, TResearchProposal, TResearchWorkspace, TSourcePolicy, TTurnInput, TUploadedSource } from "@/types/research";
import { ResearchProgress, SourceExecution, TurnExecution } from "./ResearchProgress";
import { StudioQuestion } from "./StudioQuestion";
import { committedVoiceIds, pendingVoiceCaptions } from "@/lib/voice-preview";
import { StudioComposer } from "./StudioComposer";
import { StudioInspector } from "./StudioInspector";
import { WorkspaceArtifacts } from "./WorkspaceArtifacts";
import { presentLanguage } from "./studio-language";
import { ContextArtifact } from "./ContextArtifact";
import "./cockpit.css";

export const ResearchWorkspace = () => {
  const workspace = useSavedWorkspace();
  if (workspace.isError && !workspace.data) return <div role="alert">{workspace.error.message} <Button variant="outline" onClick={() => void workspace.refetch()}>Retry</Button></div>;
  if (!workspace.data) return <p role="status" className="flex items-center gap-2 px-2 py-10 text-sm text-muted-foreground"><LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Opening workspace…</p>;
  return <Interview key={savedSession()?.session_id} initial={workspace.data} />;
};

const turnBody = (turn: TInterviewMessage, proposal?: TResearchProposal | null, proposalTurn?: string | null) => {
  if (!proposal || turn.role !== "assistant" || !proposalTurn || proposalTurn !== turn.turn_id) return turn.text;
  const listed = new Set([proposal.summary, proposal.urls.join(", ")]);
  return turn.text.split(/\n\s*\n/).filter(line => !listed.has(line.trim())).join("\n\n");
};

const sameUrls = (left: string[], right: string[]) => {
  const normalize = (url: string) => { try { return new URL(url).href; } catch { return url; } };
  return JSON.stringify(left.map(normalize)) === JSON.stringify(right.map(normalize));
};

const starterPrompts = [
  { label: "Pitch a product", message: "Help me pitch a product to prospective customers. " },
  { label: "Present my work", message: "Help me present my work to a hiring team. " },
  { label: "Make a recommendation", message: "Help me present a recommendation to my team. " },
];

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
  const [pending, setPending] = useState<TTurnInput | null>(null);
  const [failedTurn, setFailedTurn] = useState<TTurnInput | null>(null);
  const [notice, setNotice] = useState("");
  const applyButton = useRef<HTMLButtonElement>(null);
  const researchPlan = useRef<HTMLDivElement>(null);
  const researchActivity = useRef<HTMLDivElement>(null);
  const presentationPreparation = useRef<HTMLDivElement>(null);
  const [greeting, setGreeting] = useState("");
  const [compactPanel, setCompactPanel] = useState<"artifacts" | "agent" | null>(null);
  const [previewResearchId, setPreviewResearchId] = useState<string | null>(null);
  const [previewReset, setPreviewReset] = useState(0);
  const presentationHeading = useRef<HTMLHeadingElement>(null);
  const returnToConversation = useRef(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const turns = useRef<HTMLDivElement>(null);
  const followingTranscript = useRef(true);
  const sending = useRef(false);
  const parsing = useRef(false);
  const brief = workspace.brief;
  const history = useMemo(() => workspace.history ?? brief?.history ?? [], [workspace.history, brief?.history]);
  const committedCaptions = useMemo(() => committedVoiceIds(history), [history]);
  const service = useResearch(savedSession()?.session_id ?? "", workspace.job);
  const job = service.job.data ?? workspace.job;
  const running = job?.status === "running" || job?.status === "queued";
  const unsuccessful = job?.status === "needs_input" || job?.status === "failed" || job?.status === "superseded";
  const result = job ? (unsuccessful || running ? null : job.result ?? workspace.research) : workspace.research;
  const showingPresentation = !!result && previewResearchId === result.research_id;
  const currentArtifactId = result?.research_id ?? workspace.research?.research_id;
  const previousArtifacts = workspace.artifacts?.filter(artifact => artifact.research_id !== currentArtifactId) ?? [];
  const calls = service.calls.data ?? [];
  const selectSources = (next: TUploadedSource[]) => { setSources(next); saveSourceSelection(brief?.brief_id, next); };
  const savedIds = workspace.state?.source_ids ?? brief?.source_ids ?? brief?.sources?.map(source => source.source_id) ?? [];
  const changedScope = policy !== savedPolicy || materials !== savedMaterials ||
    !sameUrls(urls, savedUrls) || JSON.stringify(sources.map(s => s.source_id)) !== JSON.stringify(savedIds);
  const proposal = workspace.phase === "proposed" ? workspace.proposal : null;
  const voice = useVoiceAgent(service.getSession, {
    committed: committedCaptions,
    onClose: () => { void client.invalidateQueries({ queryKey: ["host-workspace", session?.session_id] }); },
  });
  const { handsFree, setHandsFree } = voice;
  useEffect(() => {
    if (showingPresentation && handsFree) void setHandsFree(false);
  }, [showingPresentation, handsFree, setHandsFree]);
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
    void voice.setHandsFree(true);
    if (!history.length && !greeting && !service.start.isPending) service.start.mutate(undefined, { onSuccess(reply) { setGreeting(reply.greeting); } });
  };
  const instrument = voice.phase === "requesting" ? "connecting" : voice.phase === "recording" ? "recording" :
    voice.phase === "transcribing" ? "transcribing" : voice.replying ? (voice.voiceEnabled ? "speaking" : "replying") : pending ? "thinking" :
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
  const previewTurns = pendingVoiceCaptions(voice.captions, committedCaptions);
  const approvalIndex = history.findLastIndex(turn => turn.role === "assistant" &&
    (turn.intent === "start_research" || turn.option_id === "approve" || turn.intent === "approval" || /researching the scope you approved/i.test(turn.text)));
  const stepIndex = approvalIndex >= 0 ? approvalIndex : history.length - 1;
  const callIndex = (time: string) => {
    const nextTurn = history.findIndex(turn => turn.created_at != null && turn.created_at >= Date.parse(time));
    return nextTurn === -1 ? history.length : nextTurn;
  };
  const scrollKey = [history.length, pending?.turn_id, calls.length, job?.activity?.length, result?.research_id].join("-");
  useEffect(() => {
    const pane = transcript.current;
    if (!pane || showingPresentation) return;
    followingTranscript.current = true;
    pane.scrollTop = pane.scrollHeight;
  }, [scrollKey, showingPresentation]);
  useEffect(() => {
    const pane = transcript.current;
    const list = turns.current;
    if (!pane || !list || showingPresentation) return;
    const observer = new ResizeObserver(() => {
      if (followingTranscript.current) pane.scrollTop = pane.scrollHeight;
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [showingPresentation]);
  const closeInterviewVoice = useEffectEvent(() => { if (voice.handsFree) void voice.setHandsFree(false); });
  useEffect(() => {
    if (showingPresentation) {
      closeInterviewVoice();
      presentationHeading.current?.focus();
    }
    else if (returnToConversation.current) {
      returnToConversation.current = false;
      composer.current?.focus({ preventScroll: true });
    }
  }, [showingPresentation]);

  const error = notice || service.start.error?.message || voice.error || service.job.error?.message;
  const canSend = !!message.trim() && !pending && !service.upload.isPending && !service.applySources.isPending;
  const jumpTo = (target: HTMLDivElement | null) => {
    if (!target) return;
    setCompactPanel(null);
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "nearest", behavior: "instant" });
  };
  const sourcesSummary = [
    sources.length && `${sources.length} ${sources.length === 1 ? "file" : "files"}`,
    urls.length && `${urls.length} ${urls.length === 1 ? "link" : "links"}`,
    materials && "Pasted text",
  ].filter(Boolean).join(" · ");
  const researchStatus = job && <div ref={researchActivity} className="studio-jump-target" role="group" tabIndex={-1} aria-label="Research activity status"><ResearchProgress job={job} /></div>;
  const backToConversation = () => {
    returnToConversation.current = true;
    setPreviewResearchId(null);
    setPreviewReset(reset => reset + 1);
  };
  return <div className="studio-cockpit" data-mode={showingPresentation ? "presentation" : "conversation"}>
    {!showingPresentation && <WorkspaceArtifacts
      currentResearch={session && currentArtifactId ? { project: session.session_id, researchId: currentArtifactId, getSession: service.getSession } : undefined}
      earlierResearch={session ? previousArtifacts.map(artifact => ({ project: session.session_id, researchId: artifact.research_id, getSession: service.getSession })) : []}
      onPlan={proposal ? () => jumpTo(researchPlan.current) : undefined}
      onActivity={job ? () => jumpTo(researchActivity.current) : undefined}
      onPresentation={result ? () => jumpTo(presentationPreparation.current) : undefined}
      expanded={compactPanel === "artifacts"}
      onToggle={() => setCompactPanel(panel => panel === "artifacts" ? null : "artifacts")} />}
    <Card className="cockpit-chat" role="region" aria-label={showingPresentation ? "Private presentation workspace" : "Private conversation"}>
      {showingPresentation ? <header className="chat-heading presentation-workspace-header">
        <div><Presentation size={16} aria-hidden="true" /><h2 ref={presentationHeading} tabIndex={-1}>Presentation</h2></div>
        <Button type="button" variant="ghost" size="sm" onClick={backToConversation}>
          <ArrowLeft size={15} aria-hidden="true" /> Back to conversation
        </Button>
      </header> : <header className="chat-heading"><div><MessageSquare size={16} aria-hidden="true" /><h2>Conversation</h2></div><span><LockKeyhole size={13} aria-hidden="true" />Private</span></header>}
      <div className="conversation-timeline" ref={transcript} tabIndex={0} aria-label={showingPresentation ? "Presentation review" : "Conversation timeline"}
        onScroll={({ currentTarget: pane }) => { if (!showingPresentation) followingTranscript.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 32; }}>
        {!showingPresentation && !history.length && !previewTurns.length && <div className="chat-opening">
          <span className="grid size-11 place-items-center rounded-lg bg-secondary text-primary"><AudioLines size={23} aria-hidden="true" /></span>
          <h3>{greeting || "What are you pitching?"}</h3>
          <p>Tell copitch what you’re presenting and what you want people to take away.</p>
          <div className="mt-5 flex flex-wrap gap-2" aria-label="Example starting points">
            {starterPrompts.map(({ label, message: draft }) => <Button key={label} type="button" variant="outline" size="sm" onClick={() => {
              setMessage(draft);
              composer.current?.focus();
            }}>{label}<ArrowUpRight size={13} aria-hidden="true" /></Button>)}
          </div>
        </div>}
        <div ref={turns} className={showingPresentation ? "contents" : "chat-turns"} role={showingPresentation ? undefined : "log"}
          aria-relevant={showingPresentation ? undefined : "additions"} aria-live={showingPresentation ? undefined : "polite"}
          aria-label={showingPresentation ? undefined : "Conversation messages"}>
          {!showingPresentation && <>
          {history.map((turn, index) => {
            const body = turnBody(turn, proposal, workspace.state?.proposal_turn_id);
            return <Fragment key={(turn.turn_id ?? index) + turn.role}>
            {calls.filter(call => callIndex(call.started_at) === index).map(call => <SourceExecution key={call.call_id} call={call} />)}
            {body && <div className={"chat-turn " + turn.role}>
              <div className="turn-meta"><small>{turn.role === "host" ? "You" : "copitch"}</small>
                {!!turn.voice_items?.length && <span className="turn-voice"><Mic size={11} aria-hidden="true" />Voice</span>}
                {turn.language && <span className="turn-language">{presentLanguage(turn.language)}</span>}
              </div><p lang={turn.language}>{body}</p>
            </div>}
            {turn.role === "assistant" && workspace.activities?.filter(activity => activity.turn_id === turn.turn_id && activity.tool !== "ask_input").map((activity,i) =>
              <TurnExecution key={i} activity={activity} />)}
            {index === stepIndex && researchStatus}
          </Fragment>;})}
          {calls.filter(call => callIndex(call.started_at) === history.length).map(call => <SourceExecution key={call.call_id} call={call} />)}
          {!history.length && researchStatus}
          {previewTurns.map(caption => <div key={caption.id} className={"chat-turn live-caption " + (caption.speaker === "host" ? "host" : "assistant")}
            data-recording={caption.speaker === "host" && !caption.final && voice.phase === "recording"} aria-live="off">
            <div className="turn-meta"><small>{caption.speaker === "host" ? "You" : "copitch"}</small>
              <span className="caption-label">{!voice.handsFree ? "Awaiting sync" : caption.final ? "Syncing" : "Live transcript"}</span>
            </div><p>{caption.text}</p>
          </div>)}
          {pending && !history.some(turn => turn.turn_id === pending.turn_id) && <div className="chat-turn host pending" aria-hidden="true"><small>You</small><p>{pending.message}</p></div>}
          {pending && <div className="chat-pending" role="status">copitch is replying<span aria-hidden="true">…</span></div>}
          {proposal && <div ref={researchPlan} className="studio-jump-target" role="group" tabIndex={-1} aria-label="Review research plan">
            <StudioQuestion proposal={proposal} filenames={(workspace.sources ?? brief?.sources ?? []).filter(source => savedIds.includes(source.source_id)).map(source => source.filename)}
              changed={changedScope} heard={!!workspace.state?.proposal_heard} busy={!!pending || service.upload.isPending || service.applySources.isPending}
              onChoose={(choice,label) => submit(label, choice)} />
          </div>}
          </>}
          {result && <div ref={presentationPreparation} className="studio-jump-target" role={showingPresentation ? undefined : "group"} tabIndex={showingPresentation ? undefined : -1} aria-label={showingPresentation ? undefined : "Slide preparation"}>
            <DeckWorkspace key={`${result.research_id}:${previewReset}`} researchId={result.research_id} getSession={service.getSession}
              backToConversation={backToConversation} onPreviewReady={setPreviewResearchId}
              researchAction={session && <ContextArtifact project={session.session_id} researchId={result.research_id} getSession={service.getSession} />} />
          </div>}
        </div>
      </div>
      {!showingPresentation && <>
      {error && <div role="alert" className="chat-error"><CircleAlert size={16} aria-hidden="true" /><span>{error}</span>
        {failedTurn && <Button type="button" size="sm" variant="ghost" onClick={() => execute(failedTurn)}>Retry message</Button>}
        {notice && <Button type="button" size="icon" variant="ghost" aria-label="Dismiss notice" onClick={() => setNotice("")}><X size={14} aria-hidden="true" /></Button>}
      </div>}
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
      </>}
    </Card>
    {!showingPresentation && <StudioInspector
      state={instrument} micOpen={voice.handsFree && voice.phase !== "requesting"} spokenReplies={voice.voiceEnabled}
      onToggleReplies={() => voice.enableVoice(!voice.voiceEnabled)} expanded={compactPanel === "agent"}
      onToggle={() => setCompactPanel(panel => panel === "agent" ? null : "agent")}
      goal={workspace.state?.goal ?? brief?.summary} intent={workspace.proposal?.intent ?? brief?.intent} proposed={!!proposal}
      replyLanguage={workspace.state?.reply_language} lastLanguage={workspace.state?.last_language}
      policy={policy} unappliedSources={changedScope} sourcesSummary={sourcesSummary} activity={job?.activity?.at(-1)} />}
  </div>;
};
