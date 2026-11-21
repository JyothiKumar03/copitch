import { isInterviewLanguage } from "../../shared/languages";
import { request } from "./research";
import type { TResearchSession, TResearchWorkspace, TSourceCall, TTurnInput } from "@/types/research";

export const sendStudioTurn = async (session: TResearchSession, input: TTurnInput) => {
  const path = `/api/sessions/${encodeURIComponent(session.session_id)}/interview/turn`;
  const value = await (await request(path, session, input)).json();
  if (value?.turn_id !== input.turn_id || typeof value.text !== "string" || !isInterviewLanguage(value.language) ||
      !Array.isArray(value.workspace?.history) || !value.workspace.history.every((item: { role?: unknown; text?: unknown } | null) =>
        item && (item.role === "host" || item.role === "assistant") && typeof item.text === "string")) {
    throw new Error("The reply could not be read. Retry this message.");
  }
  return { text: value.text as string, language: value.language, workspace: value.workspace as TResearchWorkspace };
};

export const fetchSourceCalls = async (session: TResearchSession, signal: AbortSignal): Promise<TSourceCall[]> => {
  const path = `/api/sessions/${encodeURIComponent(session.session_id)}/research/source-calls`;
  const value = await (await request(path, session, undefined, { signal })).json();
  if (!Array.isArray(value?.calls) || !value.calls.every((call: TSourceCall | null) => call && typeof call.call_id === "string" &&
      typeof call.filename === "string" && ["parse_pdf", "parse_csv", "parse_ppt", "parse_pptx"].includes(call.tool) &&
      ["running", "succeeded", "failed"].includes(call.status))) throw new Error("File activity is unavailable.");
  return value.calls;
};

export const acknowledgeHeardQuestion = async (session: TResearchSession, requestId: string, turnId: string) => {
  await request(`/api/sessions/${encodeURIComponent(session.session_id)}/interview/heard`, session, { request_id: requestId, turn_id: turnId });
};
