import type { TInterviewMessage } from "@/types/research";
import { isLiveHostTail as isLateHostCaption, LIVE_BACKCHANNEL_MS } from "../../shared/voice-transcript";

export type TVoiceCaption = { speaker: "host" | "agent"; text: string; id: string; final: boolean };
type TVoiceFragment = { speaker: TVoiceCaption["speaker"]; delta: string; start?: number; end?: number; eventId?: string };
type TTimedCaption = TVoiceCaption & { start: number; end: number };
type TExchange = { host?: TTimedCaption; agent?: TTimedCaption };

export const readVoiceFragment = (value: unknown): TVoiceFragment | null => {
  if (!value || typeof value !== "object" || !("type" in value) || !("delta" in value) || typeof value.delta !== "string" || !value.delta) return null;
  const speaker = value.type === "session.input_transcript.delta" ? "host" : value.type === "session.output_transcript.delta" ? "agent" : null;
  if (!speaker) return null;
  const start = "start_ms" in value && typeof value.start_ms === "number" && Number.isFinite(value.start_ms) ? value.start_ms : undefined;
  const end = "end_ms" in value && typeof value.end_ms === "number" && Number.isFinite(value.end_ms) ? value.end_ms : start;
  const eventId = "event_id" in value && typeof value.event_id === "string" ? value.event_id : undefined;
  return { speaker, delta: value.delta, start, end, eventId };
};

export { isLateHostCaption };

export const committedVoiceIds = (history: TInterviewMessage[]) => new Set(history.flatMap(turn => turn.voice_items ?? []));
export const pendingVoiceCaptions = (captions: TVoiceCaption[], committed: ReadonlySet<string>) =>
  captions.filter(caption => caption.text.trim() && !committed.has(caption.id));

export const createVoicePreview = (lease: string) => {
  let exchange: TExchange = {};
  let pending: TVoiceCaption[] = [];
  const seen = new Set<string>();
  const current = () => [exchange.host, exchange.agent].filter((caption): caption is TTimedCaption => !!caption);
  const captions = () => [...pending, ...current()];
  const seal = () => {
    pending.push(...current().map(caption => ({ ...caption, final: true })));
    exchange = {};
  };
  const reconcile = (committed: ReadonlySet<string>) => {
    if (current().some(caption => committed.has(caption.id))) seal();
    pending = pending.filter(caption => !committed.has(caption.id));
  };
  const accept = (fragment: TVoiceFragment, committed: ReadonlySet<string>) => {
    if (fragment.eventId && seen.has(fragment.eventId)) return null;
    if (fragment.eventId) seen.add(fragment.eventId);
    reconcile(committed);
    const start = fragment.start ?? 0;
    const end = fragment.end ?? start;
    const late = fragment.speaker === "host" && isLateHostCaption(fragment.start, exchange.host?.end, exchange.agent?.end);
    if (fragment.speaker === "host" && exchange.agent && !late) {
      const reply = exchange.agent;
      if (reply.end - reply.start < LIVE_BACKCHANNEL_MS && start - reply.end < LIVE_BACKCHANNEL_MS) delete exchange.agent;
      else seal();
    }
    const previous = exchange[fragment.speaker];
    const id = `${fragment.speaker === "host" ? "live" : "agent"}:${lease}:${start}`;
    exchange[fragment.speaker] = previous ? { ...previous, text: previous.text + fragment.delta, end: Math.max(previous.end, end) } :
      { id, speaker: fragment.speaker, text: fragment.delta, start, end, final: false };
    return late ? "tail" : fragment.speaker;
  };
  return { accept, captions, seal, reconcile };
};
