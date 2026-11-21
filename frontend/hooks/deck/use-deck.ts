"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { decideEdit, fetchDeck, prepareDeck, proposeEdit, startContinuation, markPoint, liveTurn, savedPitches, storePitches, saveSlideOrder, downloadPrivatePlan } from "@/lib/decks";
import type { TContinuation, TDeck, TDeckWorkspaceProps, TEditInput, TLiveTurnInput, TPitchInput, TProposal, TSavedPitch } from "@/types/deck";

export const useDeck = ({ researchId, getSession }: TDeckWorkspaceProps) => {
  const [deck, setDeck] = useState<TDeck | null>(null);
  const [proposal, setProposal] = useState<TProposal | null>(null);
  const [pitches, setPitches] = useState<TSavedPitch[]>(() => savedPitches(researchId));
  const openDeck = (next: TDeck) => {
    const label = next.pitch ? next.pitch.audience + " · " + next.pitch.duration_minutes + " min" : next.title;
    const variants = [...pitches.filter(pitch => pitch.deck_id !== next.deck_id), { deck_id: next.deck_id, label }];
    storePitches(researchId, variants);
    setPitches(variants);
    setProposal(null);
    setDeck(next);
  };
  const reopen = useMutation({
    mutationFn: async (deckId: string) => fetchDeck(await getSession(), deckId),
    onSuccess: openDeck,
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
  const [coverage, setCoverage] = useState<TContinuation | null>(null);
  const start = useMutation({
    mutationFn: async () => startContinuation(await getSession(), deck!),
    onSuccess: setCoverage,
  });
  const mark = useMutation({
    mutationFn: async ({ pointId, kind }: { pointId: string; kind: "skip" | "revisit" }) =>
      markPoint(await getSession(), deck!, coverage!, pointId, kind),
    onSuccess: setCoverage,
  });
  const turn = useMutation({
    mutationFn: async (input: TLiveTurnInput) => liveTurn(await getSession(), deck!.deck_id, input),
    onSuccess(reply) { if (reply.kind === "edit") setProposal(reply.proposal); },
  });
  return { order, downloadPlan, turn, deck, pitches, reopen, proposal, prepare, edit, decision, start, mark, coverage };
};
