import type { TInterviewStart, TUploadedSource, TSavedBrief, TResearchJob, TResearchSession, TResearchWorkspace } from "@/types/research";

export const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export const request = async (path: string, session?: TResearchSession, body?: unknown, options?: { headers?: Record<string, string>; signal?: AbortSignal }) => {
  const response = await fetch(apiBase + path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "include", cache: "no-store", signal: options?.signal,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...options?.headers,
      ...(session?.token && { Authorization: `Bearer ${session.token}` }),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw Object.assign(new Error(typeof detail?.error === "string" ? detail.error : `Research request failed (${response.status})`), { status: response.status });
  }
  return response;
};

export const createSession = async (): Promise<TResearchSession> => {
  return (await request("/api/sessions", undefined, {})).json();
};

const researchPath = (session: TResearchSession) => {
  return `/api/sessions/${encodeURIComponent(session.session_id)}/research`;
};

export const queryJob = async (session: TResearchSession, jobId: string, signal: AbortSignal): Promise<TResearchJob> => {
  return (await request(researchPath(session) + "/jobs/" + encodeURIComponent(jobId), session, undefined, { signal })).json();
};

const hostSessionKey = "equal-ai.research.host-session";

export const savedSession = (): TResearchSession | null => {
  if (typeof window === "undefined") return null;
  const project = new URLSearchParams(window.location.search).get("project");
  if (project) return { session_id: project };
  try {
    const saved = JSON.parse(sessionStorage.getItem(hostSessionKey) ?? "null");
    return typeof saved?.session_id === "string" && typeof saved?.token === "string" ? saved : null;
  } catch { return null; }
};

export const restoreWorkspace = async (): Promise<TResearchWorkspace> => {
  const session = savedSession();
  if (!session) return { brief: null, research: null };
  const response = await fetch(apiBase + "/api/sessions/" + encodeURIComponent(session.session_id) + "/interview/workspace", {
    credentials: "include", headers: session.token ? { Authorization: "Bearer " + session.token } : {}, cache: "no-store",
  });
  if (session.token && (response.status === 401 || response.status === 404)) {
    try { sessionStorage.removeItem(hostSessionKey); } catch { /* Storage may be disabled. */ }
    return { brief: null, research: null };
  }
  if (!response.ok) throw new Error("Could not open this project. Sign in again or return to Projects.");
  return response.json();
};

export const getOrCreateSession = async (): Promise<TResearchSession> => {
  const saved = savedSession();
  if (saved) return saved;
  const created = await createSession();
  try { sessionStorage.setItem(hostSessionKey, JSON.stringify(created)); } catch { /* In-memory session remains usable. */ }
  return created;
};

export const startInterview = async (session: TResearchSession): Promise<TInterviewStart> => {
  return (await request(`/api/sessions/${encodeURIComponent(session.session_id)}/interview/start`, session, {})).json();
};

export const uploadSource = async (session: TResearchSession, file: File): Promise<TUploadedSource> => {
  const form = new FormData();
  form.set("file", file, file.name);
  const response = await fetch(apiBase + researchPath(session) + "/sources", {
    method: "POST", body: form, credentials: "include", cache: "no-store", headers: session.token ? { Authorization: "Bearer " + session.token } : {},
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(typeof detail?.error === "string" ? detail.error : `Upload failed (${response.status})`);
  }
  return response.json();
};

const sourceDraftKey = (briefId?: string) => {
  const session = savedSession();
  return session && `equal-ai.sources.${session.session_id}.${briefId ?? "initial"}`;
};

export const restoreSourceSelection = (brief?: TSavedBrief | null, selected?: TUploadedSource[]): TUploadedSource[] => {
  try {
    const key = sourceDraftKey(brief?.brief_id);
    const draft = key && JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (Array.isArray(draft) && draft.every(item => typeof item?.source_id === "string" && typeof item.filename === "string")) return draft;
  } catch { /* Use the accepted selection when browser storage is unavailable. */ }
  return selected ?? brief?.sources ?? [];
};

export const saveSourceSelection = (briefId: string | undefined, sources: TUploadedSource[]) => {
  try {
    const key = sourceDraftKey(briefId);
    if (key) sessionStorage.setItem(key, JSON.stringify(sources));
  } catch { /* The host can still use this selection for the current turn. */ }
};
