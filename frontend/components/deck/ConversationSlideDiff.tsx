"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { decideEdit, fetchEdit } from "@/lib/decks";
import { missionKey } from "@/lib/mission";
import type { TDeckWorkspaceProps, TProposal } from "@/types/deck";
import { SlideDiff } from "./SlideDiff";

export const ConversationSlideDiff = ({ initial, getSession }: { initial: TProposal; getSession: TDeckWorkspaceProps["getSession"] }) => {
  const client = useQueryClient();
  const key = ["conversation-slide-edit", initial.deck_id, initial.proposal_id];
  const read = useQuery({ queryKey: key, queryFn: async () => fetchEdit(await getSession(), initial.deck_id, initial.proposal_id) });
  const decision = useMutation({
    mutationFn: async (choice: "approve" | "reject") => {
      const session = await getSession();
      return { result: await decideEdit(session, initial.deck_id, initial.proposal_id, choice), projectId: session.session_id };
    },
    onSuccess: ({ result, projectId }) => {
      client.setQueryData(key, result);
      void client.invalidateQueries({ queryKey: ["presentation-variants"] });
      if (result.status === "approved") void client.invalidateQueries({ queryKey: missionKey(projectId) });
    },
  });
  if (read.error) return <p role="alert" className="text-sm text-destructive">{read.error.message}</p>;
  if (!read.data) return <p role="status" className="text-sm text-muted-foreground">Opening slide change…</p>;
  if (read.data.status !== "pending") return <p role="status" className="text-sm text-muted-foreground">{
    read.data.status === "approved" ? `Saved slide revision ${read.data.approved_revision}.` : "Kept the current slide."}</p>;
  return <div className="grid min-w-0 gap-2">
    <SlideDiff proposal={read.data} pending={decision.isPending} onDecision={decision.mutate} />
    {decision.error && <p role="alert" className="text-sm text-destructive">{decision.error.message}</p>}
  </div>;
};
