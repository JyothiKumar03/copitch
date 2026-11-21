import type { TBriefInput, TResearchBrief, TResearchResult, TResearchSession } from "@/types/research";

const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function request(path: string, session?: TResearchSession, body?: unknown) {
  const response = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    cache: "no-store",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session && { Authorization: `Bearer ${session.token}` }),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(typeof detail?.error === "string" ? detail.error : `Research request failed (${response.status})`);
  }
  return response;
}

export async function createSession(): Promise<TResearchSession> {
  return (await request("/api/sessions", undefined, {})).json();
}

function researchPath(session: TResearchSession) {
  return `/api/sessions/${encodeURIComponent(session.session_id)}/research`;
}

export async function clarifyBrief(session: TResearchSession, input: TBriefInput): Promise<TResearchBrief> {
  return (await request(researchPath(session) + "/brief", session, input)).json();
}

export async function runResearch(session: TResearchSession, briefId: string): Promise<TResearchResult> {
  return (await request(researchPath(session), session, { brief_id: briefId, confirmed: true })).json();
}

export async function downloadResearch(session: TResearchSession, researchId: string) {
  const path = researchPath(session) + "/" + encodeURIComponent(researchId) + "/presentation.md";
  const response = await request(path, session);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = "presentation.md";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
