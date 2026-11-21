import type { TBriefReview, TInterviewTurn, TResearchBrief } from "../types/research";

export const assistant_reply = (review: Pick<TBriefReview, "summary" | "question">) =>
  [review.summary.trim(), review.question?.trim()].filter(Boolean).join("\n\n");

export const brief_history = (brief: TResearchBrief): TInterviewTurn[] => {
  if (brief.history) return brief.history;
  // Earlier snapshots retained host messages and the latest reply. Older assistant replies cannot be reconstructed.
  const turns: TInterviewTurn[] = brief.messages.map(text => ({ role: "host", text }));
  const latest = assistant_reply(brief);
  if (latest) turns.push({ role: "assistant", text: latest });
  return turns;
};
