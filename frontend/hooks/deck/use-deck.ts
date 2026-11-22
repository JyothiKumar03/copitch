"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DeckPreparationFailed, decideEdit, fetchDeck, fetchDeckVariants, prepareDeck, proposeEdit, saveSlideOrder } from "@/lib/decks";
import { missionKey } from "@/lib/mission";
import type { TDeckVariants, TPreparationInput, TPreparationProgress } from "@/lib/decks";
import type { TDeck, TDeckWorkspaceProps, TEditInput, TProposal } from "@/types/deck";

export const useDeck = ({ researchId, getSession, command }: TDeckWorkspaceProps) => {
  const [deck, setDeck] = useState<TDeck | null>(null);
  const [proposal, setProposal] = useState<TProposal | null>(null);
  const preparation = useRef<AbortController | null>(null);
  const [preparationProgress, setPreparationProgress] = useState<TPreparationProgress>("queued");
  const receiptKey = `copitch:deck-preparation:${researchId}`;
  useEffect(() => () => preparation.current?.abort(), [researchId]);
  const client = useQueryClient();
  const variants = ["presentation-variants", researchId];
  const { data: saved, error: variantsError } = useQuery({
    queryKey: variants, queryFn: async ({ signal }) => fetchDeckVariants(await getSession(), researchId, signal), retry: false,
  });
  const openDeck = (next: TDeck) => {
    const label = `${next.title} · ${next.slides.length} ${next.slides.length === 1 ? "slide" : "slides"}`;
    client.setQueryData<TDeckVariants>(variants, current => ({ decks: [
      ...(current?.decks ?? []).filter(pitch => pitch.deck_id !== next.deck_id), { deck_id: next.deck_id, label },
    ] }));
    setProposal(null);
    setDeck(next);
  };
  const reopen = useMutation({
    mutationFn: async (target: string | { deckId: string; revision: number }) =>
      typeof target === "string" ? fetchDeck(await getSession(), target) : fetchDeck(await getSession(), target.deckId, target.revision),
    onSuccess: openDeck,
  });
  const refresh = useMutation({
    mutationFn: async (deckId: string) => fetchDeck(await getSession(), deckId),
    onSuccess: next => setDeck(current => current?.deck_id === next.deck_id && current.revision <= next.revision ? next : current),
  });
  const order = useMutation({
    mutationFn: async (ids: string[]) => saveSlideOrder(await getSession(), deck!, ids),
    onSuccess: setDeck,
  });
  const prepare = useMutation({
    mutationFn: async (input: TPreparationInput) => {
      preparation.current?.abort();
      const observation = new AbortController();
      preparation.current = observation;
      setPreparationProgress("queued");
      const saveJob = (id: string | null) => {
        try {
          if (id) window.sessionStorage.setItem(receiptKey, id);
          else window.sessionStorage.removeItem(receiptKey);
        } catch { /* Polling works when local storage is unavailable. */ }
      };
      try { return await prepareDeck(await getSession(), researchId, input, observation.signal, saveJob, setPreparationProgress); }
      finally { if (preparation.current === observation) preparation.current = null; }
    },
    onSuccess: openDeck,
    onError: () => { void client.invalidateQueries({ queryKey: variants }); },
  });
  const observePreparation = prepare.mutate;
  const reopenDeck = reopen.mutate;
  const handledCommand = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (command?.research_id === researchId && handledCommand.current !== command.turn_id) {
      handledCommand.current = command.turn_id;
      if (command.deck_id) reopenDeck(command.deck_revision !== undefined ? { deckId: command.deck_id, revision: command.deck_revision } : command.deck_id);
      else if (command.job_id) observePreparation({ jobId: command.job_id, slide_count: command.slide_count });
      return;
    }
    if (!prepare.isIdle) return;
    const active = saved?.preparation;
    let storedId: string | null = null;
    try { storedId = window.sessionStorage.getItem(receiptKey); }
    catch { /* The server can return the active preparation when storage is unavailable. */ }
    if (active) observePreparation({ jobId: active.job_id, slide_count: active.slide_count });
    else if (storedId) observePreparation({ jobId: storedId });
  }, [command, researchId, receiptKey, saved?.preparation, prepare.isIdle, observePreparation, reopenDeck]);
  const edit = useMutation({
    mutationFn: async (input: TEditInput) => proposeEdit(await getSession(), deck!.deck_id, input),
    onSuccess: setProposal,
  });
  const decision = useMutation({
    mutationFn: async (choice: "approve" | "reject") => {
      const session = await getSession();
      const resolved = await decideEdit(session, deck!.deck_id, proposal!.proposal_id, choice);
      if (resolved.status === "approved") {
        void client.invalidateQueries({ queryKey: missionKey(session.session_id) });
        setDeck(await fetchDeck(session, resolved.deck_id, resolved.approved_revision ?? undefined));
      }
      setProposal(null);
    },
  });
  const recovery = prepare.error instanceof DeckPreparationFailed ? prepare.error.recovery :
    !prepare.isPending && !prepare.isSuccess ? saved?.recovery : undefined;
  return { order, deck, pitches: saved?.decks ?? [], reopen, refresh, variantsError, proposal, prepare, preparationProgress, edit, decision, recovery };
};
