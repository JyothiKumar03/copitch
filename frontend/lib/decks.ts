import type { TDeck, TPitchRequest, TSavedPitch, TEditInput, TProposal } from "@/types/deck";
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

export type TPreparationInput = TPitchRequest | { jobId: string };

export const prepareDeck = async (session: TResearchSession, researchId: string, input: TPreparationInput, signal: AbortSignal,
  saveJob: (id: string | null) => void): Promise<TDeck> => {
  const deadline = AbortSignal.timeout(300_000);
  const observation = AbortSignal.any([signal, deadline]);
  try {
    let job_id: unknown;
    if ("jobId" in input) job_id = input.jobId;
    else {
      const response = await request(deckPath(session), session, { research_id: researchId, pitch: input }, { signal: observation });
      if (response.status !== 202) { saveJob(null); return response.json(); }
      ({ job_id } = await response.json());
    }
    if (typeof job_id !== "string" || !job_id) throw new Error("The slide review did not return a job ID.");
    saveJob(job_id);
    const statusPath = `${deckPath(session)}/preparations/${encodeURIComponent(job_id)}`;
    while (true) {
      const current = await (await request(statusPath, session, undefined, { signal: observation })).json();
      if (current?.status === "completed" && current.deck?.research_id === researchId) { saveJob(null); return current.deck; }
      if (current?.status === "failed") {
        saveJob(null);
        throw new Error(typeof current.error === "string" ? current.error : "Slide review failed. Try again.");
      }
      if (current?.status !== "queued" && current?.status !== "running") throw new Error("Slide review returned an unknown status.");
      await new Promise(resolve => setTimeout(resolve, 850));
      observation.throwIfAborted();
    }
  } catch (error) {
    if (deadline.aborted) throw new Error("Slide review is taking longer than expected. Reopen the project or choose the same slide count to check again.");
    if (error instanceof Error && "status" in error && [401, 403, 404].some(status => status === error.status)) saveJob(null);
    throw error;
  }
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
