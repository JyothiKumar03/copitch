import type { TAudienceOpen, TAudienceProjection, TRelease } from "@/types/audience";
import type { TResearchSession } from "@/types/research";
import { request } from "./research";

const audiencePath = (session: TResearchSession) => {
  return "/api/sessions/" + encodeURIComponent(session.session_id) + "/audience/";
};

export const openProjection = async (session: TResearchSession, release: TRelease): Promise<TAudienceOpen> => {
  return (await request(audiencePath(session) + "open", session, release)).json();
};

export const publishProjection = async (session: TResearchSession, release: TRelease, sequence: number): Promise<{ sequence: number }> => {
  return (await request(audiencePath(session) + "publish", session, { ...release, expected_sequence: sequence })).json();
};

export const fetchProjection = async (token: string, signal: AbortSignal): Promise<TAudienceProjection> => {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
  const response = await fetch(base + "/api/audience", {
    headers: { Authorization: "Bearer " + token }, signal, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer",
  });
  if (!response.ok) throw new Error(response.status === 401 ? "Audience link expired or invalid. Ask the host to open a new view." : "Audience connection unavailable.");
  return response.json();
};
