import type { TAudienceProjection } from "@/types/audience";
import { apiBase } from "./research";

export const fetchProjection = async (token: string, signal: AbortSignal): Promise<TAudienceProjection> => {
  const response = await fetch(apiBase + "/api/audience", {
    headers: { Authorization: "Bearer " + token }, signal, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer",
  });
  if (!response.ok) throw new Error(response.status === 401 ? "Audience link expired or invalid. Ask the host to open a new view." : "Audience connection unavailable.");
  return response.json();
};
