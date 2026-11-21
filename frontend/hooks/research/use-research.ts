"use client";

import { useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { startInterview, uploadSource, queryJob, getOrCreateSession, savedSession, restoreWorkspace } from "@/lib/research";
import { applyStudioSources, fetchSourceCalls, sendStudioTurn } from "@/lib/studio-turns";
import type { TResearchJob, TResearchSession, TStudioSources, TTurnInput } from "@/types/research";

export const useResearch = (project: string, restored?: TResearchJob | null) => {
  const polling = !!savedSession()?.token || typeof EventSource === "undefined";
  const session = useRef<Promise<TResearchSession> | null>(null);
  const getSession = () => {
    session.current ??= getOrCreateSession().catch(error => {
      session.current = null;
      throw error;
    });
    return session.current;
  };
  const start = useMutation({ mutationFn: async () => startInterview(await getSession()) });
  const turn = useMutation({ mutationFn: async (input: TTurnInput) => sendStudioTurn(await getSession(), input) });
  const applySources = useMutation({ mutationFn: async (scope: TStudioSources) => applyStudioSources(await getSession(), scope) });
  const upload = useMutation({ mutationFn: async (file: File) => uploadSource(await getSession(), file) });
  const calls = useQuery({
    queryKey: ["source-calls", project],
    queryFn: async ({ signal }) => fetchSourceCalls(await getSession(), signal),
    refetchInterval: query => polling && (upload.isPending || query.state.data?.some(call => call.status === "running")) ? 700 : false,
    retry: 1,
  });
  const job = useQuery({
    queryKey: ["research-job", project, restored?.job_id],
    enabled: !!restored,
    initialData: restored ?? undefined,
    queryFn: async ({ signal }) => queryJob(await getSession(), restored!.job_id, signal),
    refetchInterval: query => polling && ["queued", "running"].includes(query.state.data?.status ?? "queued") ? 1000 : false,
    retry: 1,
  });
  return { start, turn, applySources, upload, calls, getSession, job };
};

export const useSavedWorkspace = () => useQuery({
  queryKey: ["host-workspace", savedSession()?.session_id],
  queryFn: restoreWorkspace, refetchOnMount: "always", retry: false,
});
