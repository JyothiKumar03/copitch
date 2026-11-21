import { ChevronDown, FileText, Globe2, Paperclip, Volume2, VolumeX } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { TInstrumentState, TPitchIntent, TResearchActivity, TSourcePolicy } from "@/types/research";
import { VoiceInstrument } from "./VoiceInstrument";
import { presentLanguage } from "./studio-language";

type TStudioInspectorProps = {
  state: TInstrumentState;
  micOpen: boolean;
  spokenReplies: boolean;
  onToggleReplies: () => void;
  expanded: boolean;
  onToggle: () => void;
  goal?: string | null;
  intent?: TPitchIntent;
  proposed: boolean;
  replyLanguage?: string | null;
  lastLanguage?: string;
  policy: TSourcePolicy;
  unappliedSources: boolean;
  sourcesSummary: string;
  activity?: TResearchActivity;
};

export const StudioInspector = ({ state, micOpen, spokenReplies, onToggleReplies, expanded, onToggle, goal, intent, proposed,
  replyLanguage, lastLanguage, policy, unappliedSources, sourcesSummary, activity }: TStudioInspectorProps) => {
  const disclosure = useRef<HTMLButtonElement>(null);
  const shownLanguage = replyLanguage || lastLanguage;
  const fields = intent ? [["Subject", intent.subject], ["Audience", intent.audience], ["Outcome", intent.outcome], ["Deliverable", intent.deliverable]] : [];
  return <aside className="cockpit-agent" aria-label="Agent inspector" onKeyDown={event => {
    if (event.key === "Escape" && expanded && event.currentTarget.contains(event.target as Node)) {
      onToggle();
      disclosure.current?.focus();
    }
  }}>
    <Card className="agent-panel">
      <div className="agent-panel-head">
        <VoiceInstrument state={state} micOpen={micOpen} />
        <div className="flex shrink-0 items-center gap-0.5">
          <Button type="button" variant="ghost" size="sm" className="spoken-replies px-2 text-muted-foreground" aria-label="Spoken replies" title="Spoken replies" aria-pressed={spokenReplies} onClick={onToggleReplies}>
            {spokenReplies ? <Volume2 size={16} aria-hidden="true" /> : <VolumeX size={16} aria-hidden="true" />}
            <span className="hidden text-xs xl:inline">{spokenReplies ? "On" : "Off"}</span>
          </Button>
          <Button ref={disclosure} type="button" variant="ghost" size="sm" className="compact-agent-details px-1.5 text-muted-foreground" aria-label="Agent details" title="Agent details" aria-expanded={expanded} aria-controls="studio-agent-details" onClick={onToggle}>
            <ChevronDown size={15} aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="agent-panel-details" id="studio-agent-details" data-expanded={expanded}>
        <section className="agent-section" aria-labelledby="studio-intent-title">
          <h2 id="studio-intent-title" className="text-sm font-semibold">{proposed ? "Proposed brief" : "Pitch brief"}</h2>
          {fields.length ? <dl className="mt-2 grid gap-2 text-sm leading-snug">{fields.map(([label, value]) => <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 wrap-anywhere">{value}</dd>
          </div>)}</dl> : <p className="mt-1 text-sm leading-snug break-words text-muted-foreground">{goal || "Tell the agent what you want to pitch."}</p>}
        </section>
        <section className="agent-section" aria-labelledby="studio-sources-title">
          <h2 id="studio-sources-title" className="text-sm font-semibold">Source scope</h2>
          <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
            {policy === "public_search" ? <Globe2 size={15} aria-hidden="true" className="shrink-0 text-evidence" /> : <FileText size={15} aria-hidden="true" className="shrink-0 text-evidence" />}
            {policy === "public_search" ? "Web and your files" : "Your materials only"}
          </p>
          {sourcesSummary && <p className="mt-1.5 flex items-center gap-2 text-sm text-muted-foreground"><Paperclip size={15} aria-hidden="true" className="shrink-0 text-evidence" />{sourcesSummary}</p>}
          {unappliedSources && <p className="mt-1.5 text-xs text-evidence">Unsaved source changes</p>}
        </section>
        {shownLanguage && <section className="agent-section" aria-label="Reply language">
          <h2 className="text-sm font-semibold">{replyLanguage ? "Reply preference" : "Last reply language"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{presentLanguage(shownLanguage)}</p>
          {replyLanguage && lastLanguage && replyLanguage !== lastLanguage && <p className="mt-1 text-xs text-muted-foreground">Last reply: {presentLanguage(lastLanguage)}</p>}
        </section>}
        {activity && <section className="agent-section" aria-label="Latest research activity">
          <h2 className="text-sm font-semibold">Latest research activity</h2>
          <p className="mt-1 text-sm leading-snug wrap-anywhere text-muted-foreground">{activity.label}</p>
        </section>}
      </div>
    </Card>
  </aside>;
};
