import type { SessionStore } from "../repositories/session";
import type { TResearchBrief } from "../types/research";
import { parse_state } from "../types/studio-turn";
import type { TStudioState } from "../types/studio-turn";

export const initial_studio_context = (brief?: TResearchBrief): TStudioState => ({
  ...parse_state(undefined, false),
  source_ids: brief?.sources?.map(source => source.source_id) ?? [],
  materials: brief?.materials ?? "",
  urls: brief?.urls ?? [],
  source_policy: brief?.source_policy ?? "public_search",
});

export const studio_context = (db: SessionStore, session: string) => {
  const snapshot = db.studio.snapshot(session);
  const brief = db.current_brief(session);
  const job = brief && db.research_jobs.for_brief(session, brief.brief_id);
  const state = snapshot ? parse_state(snapshot.context, !!job) : initial_studio_context(brief);
  if (job?.status === "queued" || job?.status === "running") state.phase = "researching";
  else if (state.phase === "researching" || !snapshot && job) state.phase = "done";
  return { state, revision: snapshot?.revision ?? 0, snapshot, brief, job };
};
