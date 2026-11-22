import type { TDeck, TPitchRequest, TSavedPitch, TEditInput, TProposal } from "@/types/deck";
import type { TResearchSession } from "@/types/research";
import type { TDeckPreparationFailure, TDeckPreparationPhase, TDeckRecoveryDraft, TDeckRecoverySlide } from "../../shared/presentation";
import { MAX_PRESENTATION_SLIDES } from "../../shared/presentation";
import { request } from "./research";

const deckPath = (session: TResearchSession, deckId?: string) => {
  const path = `/api/sessions/${encodeURIComponent(session.session_id)}/decks`;
  return deckId ? path + "/" + encodeURIComponent(deckId) : path;
};

type TPreparationReceipt = { job_id: string; slide_count: number };
export type TDeckVariants = { decks: TSavedPitch[]; preparation?: TPreparationReceipt; recovery?: TDeckPreparationFailure };
export type TPreparationProgress = "queued" | TDeckPreparationPhase | "running";

const activeReceipt = (value: unknown): TPreparationReceipt | undefined => {
  if (!value || typeof value !== "object" || !("job_id" in value) || typeof value.job_id !== "string" ||
    !("slide_count" in value) || typeof value.slide_count !== "number" || !Number.isInteger(value.slide_count) ||
    value.slide_count < 1 || value.slide_count > MAX_PRESENTATION_SLIDES) return;
  return { job_id: value.job_id, slide_count: value.slide_count };
};

const recoveryCodes = new Set<unknown>(["insufficient_evidence", "grounding_failed", "render_review_failed", "provider_unavailable",
  "interrupted", "preparation_failed"]);
const readRecovery = (value: unknown): TDeckPreparationFailure | undefined => {
  if (!value || typeof value !== "object") return;
  const candidate = value as Partial<TDeckPreparationFailure>;
  if (!recoveryCodes.has(candidate.reason_code) || typeof candidate.message !== "string" || !Array.isArray(candidate.gaps) ||
    !candidate.gaps.every(gap => typeof gap === "string") || typeof candidate.supported_slide_count !== "number" ||
    !Number.isInteger(candidate.supported_slide_count) || candidate.supported_slide_count < 0 ||
    candidate.supported_slide_count > MAX_PRESENTATION_SLIDES ||
    (candidate.requested_slide_count !== undefined && (!Number.isInteger(candidate.requested_slide_count) ||
      candidate.requested_slide_count < 1 || candidate.requested_slide_count > MAX_PRESENTATION_SLIDES)) ||
    (candidate.partial_deck_id !== undefined && typeof candidate.partial_deck_id !== "string")) return;
  return candidate as TDeckPreparationFailure;
};

export class DeckPreparationFailed extends Error {
  constructor(readonly recovery: TDeckPreparationFailure) { super(recovery.message); }
}

export const fetchDeckVariants = async (session: TResearchSession, researchId: string, signal?: AbortSignal): Promise<TDeckVariants> => {
  const response = await request(deckPath(session) + "?research_id=" + encodeURIComponent(researchId), session, undefined, { signal });
  const body = await response.json();
  const decks = Array.isArray(body?.decks) ? body.decks.filter((item: unknown): item is TSavedPitch =>
    !!item && typeof item === "object" && "deck_id" in item && typeof item.deck_id === "string" && "label" in item && typeof item.label === "string") : [];
  return { decks, preparation: activeReceipt(body?.preparation), recovery: readRecovery(body?.recovery) };
};

export type TPreparationInput = TPitchRequest | { jobId: string; slide_count?: number };

const preparationPhases = new Set<unknown>(["checking_evidence", "researching_gaps", "planning_slides", "reviewing_slides"]);

export const prepareDeck = async (session: TResearchSession, researchId: string, input: TPreparationInput, signal: AbortSignal,
  saveJob: (id: string | null) => void, onProgress: (progress: TPreparationProgress) => void): Promise<TDeck> => {
  const deadline = AbortSignal.timeout(360_000);
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
        const recovery = readRecovery(current.failure);
        if (recovery) throw new DeckPreparationFailed(recovery);
        throw new Error(typeof current.error === "string" ? current.error : "Slide review failed. Try again.");
      }
      if (current?.status !== "queued" && current?.status !== "running") throw new Error("Slide review returned an unknown status.");
      onProgress(current.status === "running" && preparationPhases.has(current.phase) ? current.phase : current.status);
      await new Promise(resolve => setTimeout(resolve, 850));
      observation.throwIfAborted();
    }
  } catch (error) {
    if (deadline.aborted) throw new Error("Slide review is taking longer than expected. Reopen the project or choose the same slide count to check again.");
    if (error instanceof Error && "status" in error && [401, 403, 404].some(status => status === error.status)) saveJob(null);
    throw error;
  }
};

export const fetchDeck = async (session: TResearchSession, deckId: string, revision?: number): Promise<TDeck> => {
  const query = revision === undefined ? "" : `?revision=${revision}`;
  const deck: TDeck = await (await request(deckPath(session, deckId) + query, session)).json();
  if (revision !== undefined && (deck?.deck_id !== deckId || deck.revision !== revision)) {
    throw new Error("Couldn’t confirm the saved presentation revision.");
  }
  return deck;
};

export const fetchRecoveryDraft = async (session: TResearchSession, id: string): Promise<TDeckRecoveryDraft> =>
  (await request(`${deckPath(session)}/drafts/${encodeURIComponent(id)}`, session)).json();

export const saveRecoveryDraft = async (session: TResearchSession, draft: TDeckRecoveryDraft, slideId: string,
  text: Pick<TDeckRecoverySlide, "title" | "highlights" | "narration">): Promise<TDeckRecoveryDraft> =>
  (await request(`${deckPath(session)}/drafts/${encodeURIComponent(draft.draft_id)}`, session,
    { base_revision: draft.revision, slide_id: slideId, ...text })).json();

export const proposeEdit = async (session: TResearchSession, deckId: string, input: TEditInput): Promise<TProposal> => {
  return (await request(deckPath(session, deckId) + "/edits", session, input)).json();
};

export const fetchEdit = async (session: TResearchSession, deckId: string, proposalId: string): Promise<TProposal> =>
  (await request(deckPath(session, deckId) + "/edits/" + encodeURIComponent(proposalId), session)).json();

export const decideEdit = async (session: TResearchSession, deckId: string, proposalId: string, decision: "approve" | "reject"): Promise<TProposal> => {
  const path = deckPath(session, deckId) + "/edits/" + encodeURIComponent(proposalId) + "/decision";
  return (await request(path, session, { decision })).json();
};

export const saveSlideOrder = async (session: TResearchSession, deck: TDeck, slideIds: string[]): Promise<TDeck> => {
  return (await request(deckPath(session, deck.deck_id) + "/order", session, {
    base_revision: deck.revision, slide_ids: slideIds,
  })).json();
};
