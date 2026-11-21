import type { TInterviewMessage } from "@/types/research";

type TVoiceCaption = { speaker: "host" | "agent"; text: string; id: string; final: boolean };

const comparable = (text: string) => text.normalize("NFKC").toLocaleLowerCase().replace(/[\p{P}\p{Z}\s]+/gu, "");

export const isLateHostCaption = (start: number | undefined, hostUntil: number | undefined, agentUntil: number | undefined) =>
  start !== undefined && hostUntil !== undefined && agentUntil !== undefined && start <= hostUntil && start <= agentUntil;

// A host caption is hidden only when a saved turn names its speech item, so merged or repeated words never hide or
// duplicate it. The agent speaks saved replies verbatim, so its caption is the start of the saved reply text.
export const liveCaption = (history: TInterviewMessage[], caption: TVoiceCaption | null) => {
  if (!caption || !comparable(caption.text)) return null;
  if (caption.speaker === "host") return history.some(turn => turn.role === "host" && turn.voice_items?.includes(caption.id)) ? null : caption;
  if (caption.final) return null;
  const said = comparable(caption.text);
  return history.slice(-2).some(turn => turn.role === "assistant" && comparable(turn.text).startsWith(said)) ? null : caption;
};
