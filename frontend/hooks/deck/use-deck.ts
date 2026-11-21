"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { decideEdit, fetchDeck, fetchDeckVariants, prepareDeck, proposeEdit, saveSlideOrder, downloadPrivatePlan } from "@/lib/decks";
import type { TDeck, TDeckWorkspaceProps, TEditInput, TPitchInput, TProposal, TSavedPitch } from "@/types/deck";

export const useDeck = ({ researchId, getSession }: TDeckWorkspaceProps) => {
  const [deck, setDeck] = useState<TDeck | null>(null);
  const [proposal, setProposal] = useState<TProposal | null>(null);
  const client = useQueryClient();
  const variants = ["presentation-variants", researchId];
  const { data: pitches = [], error: variantsError } = useQuery({
    queryKey: variants, queryFn: async ({ signal }) => fetchDeckVariants(await getSession(), researchId, signal), retry: false,
  });
  const openDeck = (next: TDeck) => {
    const label = next.pitch ? next.pitch.audience + " · " + next.pitch.duration_minutes + " min" : next.title;
    client.setQueryData<TSavedPitch[]>(variants, current => [
      ...(current ?? []).filter(pitch => pitch.deck_id !== next.deck_id), { deck_id: next.deck_id, label },
    ]);
    setProposal(null);
    setDeck(next);
  };
  const reopen = useMutation({
    mutationFn: async (deckId: string) => fetchDeck(await getSession(), deckId),
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
  const downloadPlan = useMutation({
    mutationFn: async () => downloadPrivatePlan(await getSession(), deck!),
  });
  const prepare = useMutation({
    mutationFn: async (pitch: TPitchInput | undefined) => prepareDeck(await getSession(), researchId, pitch),
    onSuccess: openDeck,
  });
  const edit = useMutation({
    mutationFn: async (input: TEditInput) => proposeEdit(await getSession(), deck!.deck_id, input),
    onSuccess: setProposal,
  });
  const decision = useMutation({
    mutationFn: async (choice: "approve" | "reject") => {
      const session = await getSession();
      const resolved = await decideEdit(session, deck!.deck_id, proposal!.proposal_id, choice);
      if (resolved.status === "approved") setDeck(await fetchDeck(session, resolved.deck_id));
      setProposal(null);
    },
  });
  return { order, downloadPlan, deck, pitches, reopen, refresh, variantsError, proposal, prepare, edit, decision };
};
