import { AudioLines, Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TInstrumentState } from "@/types/research";

const labels: Record<TInstrumentState, string> = {
  ready: "Mic off", connecting: "Connecting", listening: "Mic on",
  recording: "Listening to you", transcribing: "Transcribing your turn", thinking: "Preparing a reply",
  speaking: "Speaking", replying: "Replying in text", researching: "Research in progress", complete: "Research complete",
};

export const VoiceInstrument = ({ state, micOpen }: { state: TInstrumentState; micOpen: boolean }) => {
  const Icon = state === "recording" ? Mic : AudioLines;
  return <div className="flex min-w-0 items-center gap-1.5 sm:gap-3" aria-label="Voice agent">
    <span className={cn("voice-indicator grid size-7 shrink-0 place-items-center rounded-lg bg-secondary text-primary lg:size-9",
      state === "recording" && "bg-live/12 text-live")}>
      <Icon size={17} aria-hidden="true" />
    </span>
    <div className="min-w-0">
      <p className="text-sm font-semibold leading-tight">Voice agent</p>
      <p role="status" className={cn("mt-0.5 text-xs leading-tight text-muted-foreground", state === "recording" && "text-live")}>{labels[state]}</p>
      {state !== "ready" && state !== "connecting" && state !== "listening" && <p className="mt-1 hidden items-center gap-1 text-xs text-muted-foreground lg:flex">
        {micOpen ? <Mic size={11} aria-hidden="true" /> : <MicOff size={11} aria-hidden="true" />}{micOpen ? "Mic on" : "Mic off"}
      </p>}
    </div>
  </div>;
};
