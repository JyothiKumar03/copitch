import type { TPresentationAction, TPresentationOpen, TPresentationState, TStagePaint } from "@/types/presentation";
import type { TResearchSession } from "@/types/research";
import { apiBase, request } from "./research";

const livePath = (session: TResearchSession, deckId: string) =>
  `/api/sessions/${encodeURIComponent(session.session_id)}/decks/${encodeURIComponent(deckId)}/live`;

export const fetchPresentation = async (session: TResearchSession, deckId: string, signal?: AbortSignal): Promise<TPresentationState | null> => {
  try { return (await request(livePath(session, deckId), session, undefined, { signal })).json(); }
  catch (error) {
    if (error instanceof Error && "status" in error && error.status === 404) return null;
    throw error;
  }
};

export const startPresentation = async (session: TResearchSession, deckId: string, revision: number): Promise<TPresentationOpen> =>
  (await request(livePath(session, deckId) + "/start", session, { revision, approved: true })).json();

export const sendPresentationCommand = async (
  session: TResearchSession, deckId: string, state: TPresentationState, action: TPresentationAction,
): Promise<TPresentationState> => (await request(livePath(session, deckId) + "/commands", session, {
  event_id: crypto.randomUUID(), revision: state.revision, generation: state.generation, action,
})).json();

export const sendPresentationTurn = async (
  session: TResearchSession, deckId: string, pinId: string, message: string, signal: AbortSignal,
): Promise<TPresentationState> =>
  (await request(livePath(session, deckId) + "/turns", session, { turn_id: crypto.randomUUID(), pin_id: pinId, message }, { signal })).json();

export const loadPresentationAudio = async (session: TResearchSession, deckId: string, attemptId: string, signal: AbortSignal) =>
  (await request(livePath(session, deckId) + "/audio/" + encodeURIComponent(attemptId), session, undefined, { signal })).blob();

export const transcribePresentationAudio = async (session: TResearchSession, clip: Blob, signal: AbortSignal) => {
  const body = new FormData();
  body.set("audio", clip, "speech.wav");
  const path = `/api/sessions/${encodeURIComponent(session.session_id)}/interview/transcribe`;
  const response = await fetch(apiBase + path, {
    method: "POST", credentials: "include", cache: "no-store", signal, body,
    headers: session.token ? { Authorization: `Bearer ${session.token}` } : undefined,
  });
  if (!response.ok) throw new Error("Could not transcribe the recording. Try again or type your message.");
  const reply: unknown = await response.json();
  if (!reply || typeof reply !== "object" || !("text" in reply) || typeof reply.text !== "string") {
    throw new Error("The transcription was unavailable. Try again or type your message.");
  }
  return reply.text.trim();
};

export const reportStagePaint = async (token: string, paint: TStagePaint, signal: AbortSignal) => {
  const response = await fetch(apiBase + "/api/audience/paint", {
    method: "POST", credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", signal,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(paint),
  });
  if (!response.ok && response.status !== 409) throw new Error("Could not confirm the slide was shown.");
};
