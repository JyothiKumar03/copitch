"use client";

import { useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { clarifyBrief, createSession, downloadResearch, runResearch } from "@/lib/research";
import type { TBriefInput, TResearchSession } from "@/types/research";

export function useResearch() {
  const session = useRef<Promise<TResearchSession> | null>(null);
  function getSession() {
    session.current ??= createSession().catch(error => {
      session.current = null;
      throw error;
    });
    return session.current;
  }

  const clarify = useMutation({
    mutationFn: async (input: TBriefInput) => clarifyBrief(await getSession(), input),
  });
  const research = useMutation({
    mutationFn: async (briefId: string) => runResearch(await getSession(), briefId),
  });
  const download = useMutation({
    mutationFn: async (researchId: string) => downloadResearch(await getSession(), researchId),
  });
  return { clarify, research, download };
}
