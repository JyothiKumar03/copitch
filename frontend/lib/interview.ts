import { apiBase, request } from "./research";
import type { TResearchSession } from "@/types/research";

const interview = async (session: TResearchSession, action: "connect", body: string, signal: AbortSignal) => {
  const response = await fetch(`${apiBase}/api/sessions/${encodeURIComponent(session.session_id)}/interview/${action}`, {
    method: "POST", credentials: "include", signal, cache: "no-store", body,
    headers: { ...(session.token && { Authorization: `Bearer ${session.token}` }), "Content-Type": "application/sdp" },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(typeof payload?.error === "string" ? payload.error : `Interview audio request failed (${response.status}).`);
  }
  return response;
};

export const closeVoice = async (session: TResearchSession, lease: string) => {
  await request(`/api/sessions/${encodeURIComponent(session.session_id)}/interview/voice-control`, session, { kind: "close", lease });
};

export const connectInterview = async (session: TResearchSession, sdp: string, signal: AbortSignal) => {
  const response = await interview(session, "connect", sdp, signal);
  const lease = response.headers.get("X-Voice-Lease");
  if (!lease) throw new Error("The voice conversation could not connect.");
  return { lease, sdp: await response.text() };
};

export const readProgress = async (session: TResearchSession, jobId: string, message: string) => {
  const turnId = crypto.randomUUID();
  const language = /[\u0900-\u097f]/u.test(message) ? "hi" : "en";
  const path = `/api/sessions/${encodeURIComponent(session.session_id)}/interview/progress`;
  const reply = await (await request(path, session, { job_id: jobId, language, turn_id: turnId, message })).json();
  if (reply.job_id !== jobId || typeof reply.text !== "string") throw new Error("Unexpected progress response");
  return { text: reply.text as string, turnId };
};
