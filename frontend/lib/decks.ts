import type { TContinuation, TDeck, TPitchInput, TSavedPitch, TLiveReply, TLiveTurnInput, TEditInput, TProposal } from "@/types/deck";
import type { TResearchSession } from "@/types/research";
import { request } from "./research";

const deckPath = (session: TResearchSession, deckId?: string) => {
  const path = `/api/sessions/${encodeURIComponent(session.session_id)}/decks`;
  return deckId ? path + "/" + encodeURIComponent(deckId) : path;
};

export const prepareDeck = async (session: TResearchSession, researchId: string, pitch?: TPitchInput): Promise<TDeck> => {
  return (await request(deckPath(session), session, { research_id: researchId, pitch })).json();
};

export const fetchDeck = async (session: TResearchSession, deckId: string): Promise<TDeck> => {
  return (await request(deckPath(session, deckId), session)).json();
};

export const proposeEdit = async (session: TResearchSession, deckId: string, input: TEditInput): Promise<TProposal> => {
  return (await request(deckPath(session, deckId) + "/edits", session, input)).json();
};

export const decideEdit = async (session: TResearchSession, deckId: string, proposalId: string, decision: "approve" | "reject"): Promise<TProposal> => {
  const path = deckPath(session, deckId) + "/edits/" + encodeURIComponent(proposalId) + "/decision";
  return (await request(path, session, { decision })).json();
};

export const startContinuation = async (session: TResearchSession, deck: TDeck): Promise<TContinuation> => {
  return (await request(`/api/sessions/${encodeURIComponent(session.session_id)}/continuation/start`, session, {
    deck_id: deck.deck_id, revision: deck.revision,
  })).json();
};

export const markPoint = async (session: TResearchSession, deck: TDeck, snapshot: TContinuation, pointId: string, kind: "skip" | "revisit"): Promise<TContinuation> => {
  return (await request(`/api/sessions/${encodeURIComponent(session.session_id)}/continuation/commands`, session, {
    deck_id: deck.deck_id, event_id: crypto.randomUUID(), expected_revision: snapshot.revision,
    generation: snapshot.generation, action: { kind, point_id: pointId },
  })).json();
};

export const liveTurn = async (session: TResearchSession, deckId: string, input: TLiveTurnInput): Promise<TLiveReply> => {
  return (await request(deckPath(session, deckId) + "/turns", session, input)).json();
};

export const savedPitches = (researchId: string): TSavedPitch[] => {
  try {
    const list: unknown = JSON.parse(sessionStorage.getItem("equal-ai.pitches." + researchId) ?? "[]");
    return Array.isArray(list) ? list.filter(item => typeof item?.deck_id === "string" && typeof item?.label === "string") : [];
  } catch { return []; }
};

export const storePitches = (researchId: string, pitches: TSavedPitch[]) => {
  try { sessionStorage.setItem("equal-ai.pitches." + researchId, JSON.stringify(pitches)); } catch { /* This tab can still switch between in-memory decks. */ }
};

export const saveSlideOrder = async (session: TResearchSession, deck: TDeck, slideIds: string[]): Promise<TDeck> => {
  return (await request(deckPath(session, deck.deck_id) + "/order", session, {
    base_revision: deck.revision, slide_ids: slideIds,
  })).json();
};

export const downloadPrivatePlan = async (session: TResearchSession, deck: TDeck) => {
  const path = deckPath(session, deck.deck_id) + "/plan.json?revision=" + deck.revision;
  const response = await request(path, session);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = "plan.json";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
