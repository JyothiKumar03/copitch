import { apiBase, request } from "./research";
import type { TResearchSession } from "@/types/research";

const interview = async (session: TResearchSession, action: "transcribe" | "speech" | "connect", body: FormData | string, signal: AbortSignal) => {
  const response = await fetch(`${apiBase}/api/sessions/${encodeURIComponent(session.session_id)}/interview/${action}`, {
    method: "POST", credentials: "include", signal, cache: "no-store", body,
    headers: { ...(session.token && { Authorization: `Bearer ${session.token}` }), ...(typeof body === "string" && { "Content-Type": action === "connect" ? "application/sdp" : "application/json" }) },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(typeof payload?.error === "string" ? payload.error : `Interview audio request failed (${response.status}).`);
  }
  return response;
};

export const transcribeAudio = async (session: TResearchSession, audio: Blob, signal: AbortSignal) => {
  const data = new FormData();
  const extension = { "audio/mp4": "mp4", "audio/ogg": "ogg", "audio/wav": "wav" }[audio.type.split(";")[0]] ?? "webm";
  data.set("audio", audio, `interview.${extension}`);
  const response = await interview(session, "transcribe", data, signal);
  const result = await response.json();
  if (typeof result.text !== "string" || !result.text.trim()) throw new Error("No speech was recognized. Try again or type your brief.");
  return result.text.trim() as string;
};

export const speakQuestion = async (session: TResearchSession, text: string, signal: AbortSignal, progressTurnId?: string) => {
  return (await interview(session, "speech", JSON.stringify({ text, progress_turn_id: progressTurnId }), signal)).blob();
};


export const connectInterview = async (session: TResearchSession, sdp: string, signal: AbortSignal) =>
  (await interview(session, "connect", sdp, signal)).text();


export const readProgress = async (session: TResearchSession, jobId: string, message: string) => {
  const turnId = crypto.randomUUID();
  const language = /[\u0900-\u097f]/u.test(message) ? "hi" : "en";
  const path = `/api/sessions/${encodeURIComponent(session.session_id)}/interview/progress`;
  const reply = await (await request(path, session, { job_id: jobId, language, turn_id: turnId, message })).json();
  if (reply.job_id !== jobId || typeof reply.text !== "string") throw new Error("Unexpected progress response");
  return { text: reply.text as string, turnId };
};
