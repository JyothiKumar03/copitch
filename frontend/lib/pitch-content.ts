import { request } from "./research";
import type { TPitchContent } from "@/types/pitch-content";
import type { TResearchSession } from "@/types/research";

export const fetchPitchContent = async (session: TResearchSession, researchId: string, signal: AbortSignal): Promise<TPitchContent> => {
  const path = `/api/sessions/${encodeURIComponent(session.session_id)}/research/${encodeURIComponent(researchId)}/pitch`;
  return (await request(path, session, undefined, { signal })).json();
};
