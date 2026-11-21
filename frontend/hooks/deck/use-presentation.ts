"use client";

import { useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchPresentation, loadPresentationAudio, movePresentationStage, sendPresentationCommand, sendPresentationTurn, startPresentation, transcribePresentationAudio } from "@/lib/presentation";
import type { TDeck, TDeckWorkspaceProps } from "@/types/deck";
import type { TPresentationAction, TPresentationState } from "@/types/presentation";

type TStage = { token: string; external: boolean };

export const usePresentation = (deck: TDeck | null, getSession: TDeckWorkspaceProps["getSession"], researchId: string) => {
  const client = useQueryClient();
  const [activeDeck, setActiveDeck] = useState<string | null>(null);
  const [stage, setStage] = useState<TStage | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const serial = useRef<Promise<unknown>>(Promise.resolve());
  const deckId = deck?.deck_id;
  const revision = deck?.revision;
  const active = !!deckId && activeDeck === deckId;
  const key = ["presentation-live", researchId, deckId];
  const query = useQuery({
    queryKey: key, enabled: !!deckId,
    queryFn: async ({ signal }) => fetchPresentation(await getSession(), deckId!, signal),
    retry: false, refetchInterval: active ? 650 : false, refetchIntervalInBackground: active,
    structuralSharing: (current, incoming) => {
      const old = current as TPresentationState | null;
      const next = incoming as TPresentationState | null;
      return old && (!next || next.version < old.version) ? old : next;
    },
  });
  const state = query.data ?? null;

  const run = useCallback((operation: () => Promise<TPresentationState>) => {
    const queryKey = ["presentation-live", researchId, deckId];
    const job = serial.current.then(async () => {
      await client.cancelQueries({ queryKey });
      const result = await operation();
      client.setQueryData(queryKey, result);
      return result;
    });
    serial.current = job.catch(() => {});
    return job;
  }, [client, researchId, deckId]);

  const command = useCallback((action: TPresentationAction) => run(async () => {
    const current = client.getQueryData<TPresentationState>(["presentation-live", researchId, deckId]);
    if (!deckId || !current) throw new Error("Open the live presentation first.");
    return sendPresentationCommand(await getSession(), deckId, current, action);
  }), [client, getSession, deckId, researchId, run]);

  const resumeAfterNoise = useCallback((pinId: string) => run(async () => {
    const current = client.getQueryData<TPresentationState>(["presentation-live", researchId, deckId]);
    if (!deckId || !current) throw new Error("Open the live presentation first.");
    if (current.status !== "listening" || current.pin?.pin_id !== pinId) return current;
    return sendPresentationCommand(await getSession(), deckId, current, { kind: "resume" });
  }), [client, getSession, deckId, researchId, run]);

  const tryAction = async <T,>(operation: () => Promise<T>): Promise<T | null> => {
    setError(null);
    setPending(true);
    try { return await operation(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The presentation command did not finish."); return null; }
    finally { setPending(false); }
  };

  const enter = () => tryAction(() => run(async () => {
    if (!deckId || !revision) throw new Error("Open an approved deck to present.");
    const opened = await startPresentation(await getSession(), deckId, revision);
    setStage({ token: opened.stage.token, external: false });
    setActiveDeck(deckId);
    return opened.state;
  }));

  const moveStage = async (external: boolean, openWindow = false) => {
    if (!deckId) return null;
    const popup = openWindow ? window.open("about:blank", "_blank") : null;
    if (openWindow && !popup) { setError("Allow pop-ups to open the audience screen, or copy its link."); return null; }
    if (popup) popup.opener = null;
    const previous = stage;
    setStage(null);
    let token: string | null = null;
    const result = await tryAction(() => run(async () => {
      const opened = await movePresentationStage(await getSession(), deckId);
      token = opened.stage.token;
      setStage({ token, external });
      popup?.location.replace("/audience#" + token);
      return opened.state;
    }));
    if (!result) { popup?.close(); setStage(previous); }
    return token;
  };

  const leave = async () => {
    const paused = await tryAction(() => command({ kind: "pause" }));
    if (!paused) return;
    setActiveDeck(null);
    setStage(null);
  };

  const turn = (pinId: string, message: string) => tryAction(() => run(async () => {
    if (!deckId) throw new Error("Open the live presentation first.");
    return sendPresentationTurn(await getSession(), deckId, pinId, message);
  }));

  const loadAudio = useCallback(async (attemptId: string, signal: AbortSignal) => {
    if (!deckId) throw new Error("Open the live presentation first.");
    return loadPresentationAudio(await getSession(), deckId, attemptId, signal);
  }, [deckId, getSession]);

  const transcribe = useCallback(async (clip: Blob, signal: AbortSignal) => transcribePresentationAudio(await getSession(), clip, signal), [getSession]);

  return { active, command, enter, error: error ?? query.error?.message, leave, loadAudio, moveStage, pending, resumeAfterNoise, stage, state, transcribe, tryAction, turn };
};
