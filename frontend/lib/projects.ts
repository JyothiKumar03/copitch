import { apiBase } from "./research";

export type TProject = { session_id: string; name: string; created_at: number };
export type TWorkspaceProjects = { email: string; projects: TProject[] };

const projectRequest = async (path: string, body?: unknown) => {
  const response = await fetch(apiBase + "/api/" + path, {
    method: body === undefined ? "GET" : "POST", credentials: "include", cache: "no-store",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return response;
};

const checkResponse = async (response: Response) => {
  if (response.ok) return;
  const detail = await response.json().catch(() => null);
  throw new Error(typeof detail?.error === "string" ? detail.error : "Request failed. Please try again.");
};

export const loadProjects = async (): Promise<TWorkspaceProjects | null> => {
  const response = await projectRequest("projects");
  if (response.status === 401) return null;
  await checkResponse(response);
  return response.json();
};

export const authenticateAccount = async (mode: "login" | "register", email: string, password: string) => {
  await checkResponse(await projectRequest("account/" + mode, { email, password }));
};

export const addProject = async (name: string): Promise<TProject> => {
  const response = await projectRequest("projects", { name });
  await checkResponse(response);
  return response.json();
};

export const importPreviousProject = async (session: { session_id: string; token: string }) => {
  const response = await projectRequest("projects/import", { ...session, name: "Previous pitch" });
  await checkResponse(response);
  try { sessionStorage.removeItem("equal-ai.research.host-session"); } catch { /* The server already revoked the old credential. */ }
  return response.json() as Promise<TProject>;
};

export const signOut = async () => {
  await checkResponse(await projectRequest("account/logout", {}));
};

export const clearPrivateDrafts = () => {
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (/^(equal-ai\.|copitch\.)/.test(key)) sessionStorage.removeItem(key);
    }
  } catch { /* Storage can be unavailable in private browsing. */ }
};
