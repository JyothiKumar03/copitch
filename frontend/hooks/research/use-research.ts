"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { activeJob, startInterview, uploadSource, rememberJob, queryJob, clarifyBrief, getOrCreateSession, restoreWorkspace, downloadResearch, runResearch } from "@/lib/research";
import type { TBriefInput, TResearchJob, TResearchSession } from "@/types/research";

export const useResearch = (briefId?: string, restored?: TResearchJob | null) => {
  const client = useQueryClient();
  const [jobId, setJobId] = useState(() => restored?.job_id ?? activeJob(briefId));
  const session = useRef<Promise<TResearchSession> | null>(null);
  const getSession = () => {
    session.current ??= getOrCreateSession().catch(error => {
      session.current = null;
      throw error;
    });
    return session.current;
  };

  const watchJob = (job: TResearchJob) => {
    rememberJob(job); client.setQueryData(["research-job", job.job_id], job); setJobId(job.job_id);
  };
  const start = useMutation({
    mutationFn: async () => startInterview(await getSession()),
    onSuccess(reply) { if (reply.workspace.job) watchJob(reply.workspace.job); },
  });
  const upload = useMutation({ mutationFn: async (file: File) => uploadSource(await getSession(), file) });
  const clarify = useMutation({
    mutationFn: async (input: TBriefInput) => clarifyBrief(await getSession(), input),
  });
  const research = useMutation({
    mutationFn: async (input: { briefId: string; retry: boolean; approvalText: string }) =>
      runResearch(await getSession(), input.briefId, input.retry, input.approvalText),
    onSuccess: watchJob,

  });
  const job = useQuery({
    queryKey: ["research-job", jobId],
    enabled: !!jobId,
    initialData: restored?.job_id === jobId ? restored : undefined,
    queryFn: async ({ signal }) => queryJob(await getSession(), jobId!, signal),
    refetchInterval(query) {
      const status = query.state.data?.status;
      return !status || status === "queued" || status === "running" ? 1200 : false;
    },
    retry: 1,
  });
  const download = useMutation({
    mutationFn: async (researchId: string) => downloadResearch(await getSession(), researchId),
  });
  return { start, upload, clarify, research, download, getSession, job };
};

export const useSavedWorkspace = () => {
  return useQuery({ queryKey: ["host-workspace"], queryFn: restoreWorkspace, staleTime: Infinity,
    refetchOnMount: "always", retry: false });
};
