"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpRight, Check, ChevronDown, FileText, LockKeyhole, MessageSquare, Volume2, VolumeX, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { DeckWorkspace } from "@/components/deck/DeckWorkspace";
import { useBriefDictation } from "@/hooks/research/use-brief-dictation";
import { useStudioEvents } from "@/hooks/research/use-studio-events";
import { useResearch, useSavedWorkspace } from "@/hooks/research/use-research";
import { acknowledgeHeardQuestion } from "@/lib/studio-turns";
import { savedSession, restoreSourceSelection, saveSourceSelection } from "@/lib/research";
import { DEFAULT_LANGUAGE, type TInterviewLanguage } from "../../../shared/languages";
import type { TInterviewMessage, TResearchWorkspace, TStudioQuestion, TTurnInput, TUploadedSource } from "@/types/research";
import { ResearchProgress, SourceExecution, TurnExecution } from "./ResearchProgress";
import { ResearchMemo } from "./ResearchMemo";
import { PitchFileViewer } from "./PitchFileViewer";
import { StudioQuestion } from "./StudioQuestion";
import { StudioComposer } from "./StudioComposer";
import { VoiceInstrument } from "./VoiceInstrument";
import "./cockpit.css";

export const ResearchWorkspace = () => {
  const workspace = useSavedWorkspace();
  if (workspace.isError && !workspace.data) return <div role="alert">{workspace.error.message} <Button variant="outline" onClick={() => void workspace.refetch()}>Retry</Button></div>;
  if (!workspace.data) return <p role="status">Opening workspace…</p>;
  return <Interview initial={workspace.data} />;
};

const PitchButton = ({ onOpen, earlier = false }: { onOpen: () => void; earlier?: boolean }) => (
  <button type="button" onClick={onOpen} aria-haspopup="dialog" className="pitch-file" aria-label={earlier ? "Earlier pitch.md" : "pitch.md"}>
    <span className="pitch-icon"><FileText size={21} /></span>
    <span className="min-w-0 flex-1"><strong>pitch.md</strong><small>{earlier ? "Earlier pitch" : "Open saved pitch"}</small></span><ArrowUpRight size={17} />
  </button>
);

const Interview = ({ initial }: { initial: TResearchWorkspace }) => {
  const workspace = initial;
  const client = useQueryClient();
  const session = savedSession();
  useStudioEvents(session);
  const [replacingScope, setReplacingScope] = useState(false);
  const [message, setMessage] = useState("");
  const [answerTo, setAnswerTo] = useState<string | null>(null);
  const heardQuestion = useRef<{ id: string; turnId: string; acknowledgement: Promise<boolean> } | null>(null);
  const [language, setLanguage] = useState<TInterviewLanguage>(initial.context?.language_preference ?? DEFAULT_LANGUAGE);
  const [sources, setSources] = useState<TUploadedSource[]>(() => {
    const saved = restoreSourceSelection(initial.brief);
    return initial.brief || saved.length ? saved : initial.sources ?? [];
  });
  const [materials, setMaterials] = useState(initial.context?.materials ?? initial.brief?.materials ?? "");
  const [urls, setUrls] = useState<string[]>(initial.brief?.urls ?? initial.context?.entities?.urls ?? []);
  const [policy, setPolicy] = useState(initial.context?.source_policy ?? initial.brief?.source_policy ?? "public_search");
  const [pending, setPending] = useState<TTurnInput | null>(null);
  const [failedTurn, setFailedTurn] = useState<TTurnInput | null>(null);
  const [notice, setNotice] = useState("");
  const [greeting, setGreeting] = useState("");
  const [selectedPitch, setSelectedPitch] = useState<string | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const sending = useRef(false);
  const parsing = useRef(false);
  const wantsVoice = useRef(false);
  const brief = workspace.brief;
  const history = workspace.history ?? brief?.history ?? [];
  const service = useResearch(savedSession()?.session_id ?? "", workspace.job);
  const job = service.job.data ?? workspace.job;
  const running = job?.status === "running" || job?.status === "queued";
  const result = job?.result ?? workspace.research;
  const archived = (workspace.artifacts ?? []).filter(item => item.research_id !== result?.research_id);
  const calls = service.calls.data ?? [];
  const selectSources = (next: TUploadedSource[]) => { setSources(next); saveSourceSelection(brief?.brief_id, next); };
  const savedIds = brief?.source_ids ?? brief?.sources?.map(source => source.source_id) ?? [];
  const changedScope = !!brief && (policy !== brief.source_policy || materials !== brief.materials ||
    JSON.stringify(urls) !== JSON.stringify(brief.urls) || JSON.stringify(sources.map(s => s.source_id)) !== JSON.stringify(savedIds));
  const reviewable = !!brief && (workspace.context ? workspace.context.reviewable_brief_id === brief.brief_id : !brief.question);
  const canApprove = reviewable && !running && !result && !changedScope && !workspace.context?.pending;
  const voice = useBriefDictation(service.getSession, {
    language, suspended: !!pending || service.upload.isPending,
    onFinal: (text: string, turnId: string) => submit(text, "speech", turnId, answerTo ?? undefined),
    onReplyPlayback: (turnId: string, state: "playing" | "completed" | "interrupted") => {
      if (state !== "completed") { heardQuestion.current = null; return; }
      const current = client.getQueryData<TResearchWorkspace>(["host-workspace", session?.session_id])?.pending_question;
      if (current?.turn_id !== turnId) return;
      const acknowledgement = service.getSession().then(active => acknowledgeHeardQuestion(active, current.request_id, turnId)).then(() => true, () => false);
      heardQuestion.current = { id: current.request_id, turnId, acknowledgement };
    },
  });
  const submit = (text: string, input: "typed" | "speech" = "typed", turnId: string = crypto.randomUUID(), questionId?: string, optionId?: string) => {
    if (!text.trim() || sending.current || parsing.current) return;
    const payload: TTurnInput = { turn_id: turnId, message: text.trim(), input,
      ...(questionId && { answer_to: questionId }), ...(optionId && { option_id: optionId }),
      ...(running && replacingScope && { replace_scope: true }), ...(brief && { brief_id: brief.brief_id }), source_policy: policy, materials, urls, source_ids: sources.map(s => s.source_id) };
    const heard = input === "speech" && !questionId ? heardQuestion.current : null;
    if (heard) { payload.heard_question_id = heard.id; payload.heard_turn_id = heard.turnId; }
    execute(payload, heard?.acknowledgement);
  };
  const execute = async (payload: TTurnInput, acknowledgement?: Promise<boolean>) => {
    if (sending.current) return;
    sending.current = true;
    setFailedTurn(null); setNotice(""); setPending(payload);
    if (payload.input === "typed" && message.trim() === payload.message) setMessage("");
    voice.stopPlayback();
    if (acknowledgement && !await acknowledgement) {
      delete payload.heard_question_id; delete payload.heard_turn_id;
    }
    service.turn.mutate(payload, {
      onSuccess(reply) {
        const next = reply.workspace;
        client.setQueryData(["host-workspace", session?.session_id], next);
        setAnswerTo(null);
        if (payload.option_id) composer.current?.focus();
        setReplacingScope(false); setLanguage(next.context?.language_preference ?? reply.language);
        setPolicy(current => current === payload.source_policy ? next.context?.source_policy ?? next.brief?.source_policy ?? current : current);
        setUrls(current => JSON.stringify(current) === JSON.stringify(payload.urls) ? next.context?.entities?.urls ?? next.brief?.urls ?? current : current);
        saveSourceSelection(next.brief?.brief_id, sources);
        if (wantsVoice.current) void voice.readQuestion(reply.text, payload.turn_id);
      },
      onError(error) {
        if ("status" in error && error.status === 409) {
          setAnswerTo(null); setMessage(payload.message);
          void client.invalidateQueries({ queryKey: ["host-workspace", session?.session_id] });
        } else setFailedTurn(payload);
        setNotice("status" in error && error.status === 409 ? "The conversation changed. Review the current question before sending again." : error.message);
      },
      onSettled() { sending.current = false; setPending(null); },
    });
  };
  const toggleVoice = () => {
    wantsVoice.current = !voice.handsFree;
    if (voice.handsFree) { void voice.setHandsFree(false); return; }
    void voice.setHandsFree(true);
    if (!history.length && !greeting && !service.start.isPending) service.start.mutate(undefined, {
      onSuccess(reply) {
        setGreeting(reply.greeting);
        if (wantsVoice.current) void voice.readQuestion(reply.greeting);
      },
    });
  };
  const instrument = voice.phase === "requesting" ? "connecting" : voice.phase === "recording" ? "recording" :
    voice.phase === "transcribing" ? "transcribing" : voice.speaking ? "speaking" : pending ? "thinking" :
    running ? "researching" : voice.handsFree ? "listening" : result ? "complete" : "ready";

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
  const questionProps = {
    pendingId: workspace.pending_question?.request_id, scope: brief, history, busy: !!pending,
    onChoose: (question: TStudioQuestion, id: string, label: string) => submit(label, "typed", crypto.randomUUID(), question.request_id, id),
    onCompose: (question: TStudioQuestion, spoken: boolean) => {
      setAnswerTo(question.request_id); composer.current?.focus();
      if (spoken && !voice.handsFree) toggleVoice();
    },
  };
  const turnBody = (turn: TInterviewMessage) => {
    if (turn.role !== "assistant") return turn.text;
    const question = workspace.activities?.find(activity => activity.turn_id === turn.turn_id && activity.tool === "ask_input")?.question?.question;
    return question && turn.text.endsWith(question) ? turn.text.slice(0, -question.length).trim() : turn.text;
  };
  const approvalIndex = history.findLastIndex(turn => turn.role === "assistant" &&
    (turn.intent === "approval" || /researching the scope you approved/i.test(turn.text)));
  const stepIndex = approvalIndex >= 0 ? approvalIndex : history.length - 1;
  const callIndex = (time: string) => {
    const nextTurn = history.findIndex(turn => turn.created_at != null && turn.created_at >= Date.parse(time));
    return nextTurn === -1 ? history.length : nextTurn;
  };
  const scrollKey = [history.length, pending?.turn_id, calls.length, job?.activity?.length, result?.research_id, voice.interimTranscript].join("-");
  useEffect(() => {
    const pane = transcript.current;
    if (pane) pane.scrollTop = pane.scrollHeight;
  }, [scrollKey]);

  const error = notice || service.start.error?.message || voice.error || service.job.error?.message || service.download.error?.message;
  const canSend = !!(message.trim() || changedScope) && !pending && !service.upload.isPending;
  return <div className="studio-cockpit">
    <section className="cockpit-chat" aria-label="Private conversation">
      <header className="chat-heading"><div><MessageSquare size={16} aria-hidden="true" /><h2>Conversation</h2></div><span><LockKeyhole size={12} />Private</span></header>
      <div className="conversation-timeline" ref={transcript} tabIndex={0} aria-label="Conversation timeline">
        {!history.length && <div className="chat-opening"><span>copitch</span><h3>{greeting || "What are you pitching?"}</h3><p>Tell me who’s listening and what you want them to take away.</p></div>}
        <div className="chat-turns" role="log" aria-relevant="additions" aria-live="polite" aria-label="Conversation messages">
          {history.map((turn, index) => <Fragment key={(turn.turn_id ?? index) + turn.role}>
            {calls.filter(call => callIndex(call.started_at) === index).map(call => <SourceExecution key={call.call_id} call={call} />)}
            {turnBody(turn) && <div className={"chat-turn " + turn.role}><small>{turn.role === "host" ? "You" : "copitch"}</small><p>{turnBody(turn)}</p></div>}
            {turn.role === "assistant" && workspace.activities?.filter(activity => activity.turn_id === turn.turn_id).map((activity,i) =>
              activity.tool === "ask_input" && activity.question ? <StudioQuestion key={activity.question.request_id} question={activity.question} {...questionProps} /> : <TurnExecution key={i} activity={activity} />)}
            {job && index === stepIndex && <ResearchProgress job={job} />}
            {archived.filter(item => Math.min(item.after_turn, history.length - 1) === index).map(item =>
              <PitchButton key={item.research_id} earlier onOpen={() => setSelectedPitch(item.research_id)} />)}
          </Fragment>)}
          {calls.filter(call => callIndex(call.started_at) === history.length).map(call => <SourceExecution key={call.call_id} call={call} />)}
          {!history.length && job && <ResearchProgress job={job} />}
          {pending && !history.some(turn => turn.turn_id === pending.turn_id) && <div className="chat-turn host pending" aria-hidden="true"><small>You</small><p>{pending.message}</p></div>}
          {voice.interimTranscript && <div className="chat-turn host interim" aria-live="off" aria-label="Live transcript"><small>You · speaking</small><p>{voice.interimTranscript}</p></div>}
          {pending && <div className="chat-pending" role="status">copitch is replying<span aria-hidden="true">…</span></div>}
          {workspace.pending_question && !workspace.activities?.some(activity => activity.question?.request_id === workspace.pending_question?.request_id) && <StudioQuestion question={workspace.pending_question} {...questionProps} />}
          {running && <button type="button" className="scope-change" onClick={() => { setReplacingScope(!replacingScope); composer.current?.focus(); }}>
            {replacingScope ? "Cancel scope change" : "Change research scope"}
          </button>}
          {replacingScope && running && <p className="tool-detail">Send the revised scope to replace this research run.</p>}
          {!workspace.pending_question && !result && (canApprove || workspace.context?.pending) && <div className="scope-actions">
            {workspace.context?.pending ? <Button variant="outline" size="sm" disabled={!!pending} onClick={() => submit("Yes, confirm this URL.")}>Confirm URL</Button> :
              canApprove && brief && <><p>{brief.source_policy === "files_only" ? "Your materials only" : "Your materials and approved public research"}</p>
                {brief.urls.length > 0 && <ul>{brief.urls.map(url => <li key={url}>{url}</li>)}</ul>}
                {brief.public_queries.length > 0 && <ul>{brief.public_queries.map(q => <li key={q}>{q}</li>)}</ul>}
                <Button size="sm" variant="outline" disabled={!!pending || service.upload.isPending}
                  onClick={() => submit(job?.status === "failed" ? "Retry research." : "Start researching.")}>
                  <Check size={15} />{job?.status === "failed" ? "Retry research" : "Start researching"}</Button></>}
          </div>}
          {result && <div aria-label="Pitch response" className="pitch-response">
            <PitchButton onOpen={() => setSelectedPitch(result.research_id)} />
            <details className="result-details"><summary>Research memo and sources <ChevronDown size={14} /></summary>
              <ResearchMemo markdown={result.markdown} />
              {result.gaps.length > 0 && <div><h3>Evidence gaps</h3><ul>{result.gaps.map((gap,i) => <li key={i}>{gap}</li>)}</ul></div>}
              <Button size="sm" variant="outline" disabled={service.download.isPending} onClick={() => service.download.mutate(result.research_id)}>
                <ArrowDownToLine size={15} />Download memo</Button>
            </details>
            <details className="result-details"><summary>Presentation options <ChevronDown size={14} /></summary><DeckWorkspace key={result.research_id} researchId={result.research_id} getSession={service.getSession} /></details>
          </div>}
        </div>
      </div>
      {error && <div role="alert" className="chat-error"><span>{error}</span>
        {failedTurn && <button onClick={() => execute(failedTurn)}>Retry message</button>}
        {notice && <button aria-label="Dismiss notice" onClick={() => setNotice("")}><X size={14} /></button>}</div>}
      {answerTo && <div className="replying-to"><span>Answering {workspace.pending_question?.question ?? "an earlier question"}</span>
        <button type="button" aria-label="Cancel answering" onClick={() => { setAnswerTo(null); }}><X size={13} /></button></div>}
      <StudioComposer inputRef={composer} message={message} setMessage={setMessage} sources={sources} urls={urls} materials={materials}
        policy={policy} setPolicy={setPolicy} canSend={canSend} sending={!!pending} uploading={service.upload.isPending}
        attachFiles={files => void attachFiles(files)} attachUrl={attachUrl} attachText={attachText} removeFile={id => selectSources(sources.filter(s => s.source_id !== id))}
        removeUrl={url => setUrls(urls.filter(item => item !== url))} removeText={() => setMaterials("")}
        voiceActive={voice.handsFree} toggleVoice={toggleVoice} submit={() => submit(message.trim() || "Update the research sources.", "typed", crypto.randomUUID(), answerTo ?? undefined)} />
    </section>
    <aside className="cockpit-agent" aria-label="Agent and microphone controls"><VoiceInstrument state={instrument} />
      <div className="agent-settings"><span>Spoken replies</span><button type="button" aria-pressed={voice.voiceEnabled} onClick={() => voice.enableVoice(!voice.voiceEnabled)}>
        {voice.voiceEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}{voice.voiceEnabled ? "On" : "Off"}</button></div>
      {voice.speaking && <Button variant="outline" size="sm" onClick={voice.stopPlayback}>Stop reply</Button>}
    </aside>
    {selectedPitch && <PitchFileViewer researchId={selectedPitch} getSession={service.getSession} onClose={() => setSelectedPitch(null)} />}
  </div>;
};
