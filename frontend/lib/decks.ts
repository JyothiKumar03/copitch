import type { TDeck, TPitchInput, TSavedPitch, TEditInput, TProposal } from "@/types/deck";
import type { TResearchSession } from "@/types/research";
import { request } from "./research";

const deckPath = (session: TResearchSession, deckId?: string) => {
  const path = `/api/sessions/${encodeURIComponent(session.session_id)}/decks`;
  return deckId ? path + "/" + encodeURIComponent(deckId) : path;
};

export const fetchDeckVariants = async (session: TResearchSession, researchId: string, signal?: AbortSignal): Promise<TSavedPitch[]> => {
  const response = await request(deckPath(session) + "?research_id=" + encodeURIComponent(researchId), session, undefined, { signal });
  const body = await response.json();
  return Array.isArray(body?.decks) ? body.decks.filter((item: unknown): item is TSavedPitch =>
    !!item && typeof item === "object" && "deck_id" in item && typeof item.deck_id === "string" && "label" in item && typeof item.label === "string") : [];
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
