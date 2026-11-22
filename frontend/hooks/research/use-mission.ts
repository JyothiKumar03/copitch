"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { missionKey, readMission, sendMissionCommand } from "@/lib/mission";
import type { TMissionCommand } from "@/lib/mission";
import type { TResearchSession } from "@/types/research";

export const useMission = (session: TResearchSession | null) => {
  const client = useQueryClient();
  const projectId = session?.session_id;
  const queryKey = missionKey(projectId);
  const query = useQuery({
    queryKey,
    enabled: !!session,
    queryFn: ({ signal }) => session ? readMission(session, signal) : null,
    refetchInterval: state => state.state.data?.status === "working" ? 1400 : false,
    retry: false,
  });
  const change = useMutation({
    mutationFn: ({ missionId, command }: { missionId: string; command: TMissionCommand }) => {
      if (!session) throw new Error("Open the project before changing its mission.");
      return sendMissionCommand(session, missionId, command);
    },
    onMutate: () => client.cancelQueries({ queryKey }),
    onSuccess: next => {
      client.setQueryData(queryKey, next);
      void client.invalidateQueries({ queryKey: ["host-workspace", projectId] });
      if (next.status === "stopped" || next.status === "paused") void client.invalidateQueries({ queryKey: ["research-job", projectId] });
    },
    onSettled: () => { void client.invalidateQueries({ queryKey }); },
  });
  return { query, change };
};
