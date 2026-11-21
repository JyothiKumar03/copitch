"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchPresentation, loadPresentationAudio, sendPresentationCommand, sendPresentationTurn, startPresentation, transcribePresentationAudio } from "@/lib/presentation";
import type { TDeck, TDeckWorkspaceProps } from "@/types/deck";
import type { TPresentationAction, TPresentationState } from "@/types/presentation";
import { prepareRoomInput } from "./use-room-microphone";

type TPresentationTarget = Pick<TPresentationState, "cursor" | "revision" | "generation">;

export const usePresentation = (deck: TDeck | null, getSession: TDeckWorkspaceProps["getSession"], researchId: string) => {
  const client = useQueryClient();
  const [activeDeck, setActiveDeck] = useState<string | null>(null);
  const [stageToken, setStageToken] = useState<string>();
  const [pending, setPending] = useState(false);
  const [turnPending, setTurnPending] = useState(false);
  const [roomInput, setRoomInput] = useState<ReturnType<typeof prepareRoomInput> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const serial = useRef<Promise<unknown>>(Promise.resolve());
  const openingInput = useRef<ReturnType<typeof prepareRoomInput> | null>(null);
  const activeTurn = useRef<AbortController | null>(null);
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

  useEffect(() => () => {
    openingInput.current?.close();
    openingInput.current = null;
    activeTurn.current?.abort();
  }, [deckId]);

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
    const result = await sendPresentationCommand(await getSession(), deckId, current, action);
    if (action.kind !== "playing" && action.kind !== "ended" && action.kind !== "failed") activeTurn.current?.abort();
    return result;
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

  const enter = async () => {
    if (!deckId || !revision || openingInput.current) return;
    // Request permission and resume the audio context on the existing approval gesture.
    const input = prepareRoomInput();
    openingInput.current = input;
    const opened = await tryAction(() => run(async () => {
      const result = await startPresentation(await getSession(), deckId, revision);
      if (openingInput.current === input) {
        setStageToken(result.stage.token);
        setActiveDeck(deckId);
        setRoomInput(input);
      }
      return result.state;
    }));
    if (!opened && openingInput.current === input) { input.close(); openingInput.current = null; }
  };

  const interrupt = (target: TPresentationTarget) => tryAction(() => run(async () => {
    const current = client.getQueryData<TPresentationState>(key);
    if (!deckId || !current || current.revision !== target.revision || current.generation !== target.generation ||
        current.cursor.slide_id !== target.cursor.slide_id) throw new Error("The slide changed before the interruption could be saved.");
    if (current.status === "listening" && current.pin) return current;
    return sendPresentationCommand(await getSession(), deckId, current, { kind: "interrupt" });
  }));

  const leave = async () => {
    const paused = await tryAction(() => command({ kind: "pause" }));
    if (!paused) return false;
    openingInput.current?.close();
    openingInput.current = null;
    setRoomInput(null);
    setActiveDeck(null);
    setStageToken(undefined);
    return true;
  };

  const turn = async (pinId: string, message: string) => {
    if (!deckId || activeTurn.current) return null;
    const request = new AbortController();
    activeTurn.current = request;
    setTurnPending(true);
    setError(null);
    try {
      const result = await sendPresentationTurn(await getSession(), deckId, pinId, message, request.signal);
      if (request.signal.aborted) return null;
      client.setQueryData<TPresentationState>(key, current => current && current.version > result.version ? current : result);
      return result;
    } catch (cause) {
      if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not send the presentation question.");
      return null;
    } finally {
      if (activeTurn.current === request) {
        activeTurn.current = null;
        setTurnPending(false);
      }
    }
  };

  const loadAudio = useCallback(async (attemptId: string, signal: AbortSignal) => {
    if (!deckId) throw new Error("Open the live presentation first.");
    return loadPresentationAudio(await getSession(), deckId, attemptId, signal);
  }, [deckId, getSession]);

  const transcribe = useCallback(async (clip: Blob, signal: AbortSignal) => transcribePresentationAudio(await getSession(), clip, signal), [getSession]);

  return { active, command, enter, error: error ?? query.error?.message, interrupt, leave, loadAudio, pending, resumeAfterNoise,
    roomInput, stageToken, state, transcribe, tryAction, turn, turnPending };
};
