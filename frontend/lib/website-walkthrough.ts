import { WEBSITE_WALKTHROUGH_DEPTHS } from "../../shared/website-walkthrough";
import type { TWebsiteWalkthrough, TWebsiteWalkthroughInput } from "../../shared/website-walkthrough";
import { apiBase, request } from "./research";

const walkthroughPath = (projectId: string, walkthroughId?: string) => {
  const collection = `/api/sessions/${encodeURIComponent(projectId)}/website-walkthroughs`;
  return walkthroughId ? `${collection}/${encodeURIComponent(walkthroughId)}` : collection;
};

export const captureImage = (projectId: string, walkthroughId: string, captureId: number) =>
  `${apiBase}${walkthroughPath(projectId, walkthroughId)}/screenshots/${captureId}`;

const isDepth = (value: unknown) => WEBSITE_WALKTHROUGH_DEPTHS.some(depth => depth === value);
const statuses = new Set<unknown>(["queued", "capturing", "exporting", "completed", "failed"]);
const isWebUrl = (value: unknown) => {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
};

const readWalkthrough = (body: unknown): TWebsiteWalkthrough => {
  if (!body || typeof body !== "object" || !("walkthrough_id" in body) || typeof body.walkthrough_id !== "string" ||
      !("status" in body) || !statuses.has(body.status) || !("url" in body) || !isWebUrl(body.url) ||
      !("audience" in body) || typeof body.audience !== "string" || !("goal" in body) || typeof body.goal !== "string" || !("max_depth" in body) || !isDepth(body.max_depth) ||
      !("created_at" in body) || typeof body.created_at !== "number" || !Number.isFinite(body.created_at) || !("pages" in body) || !Array.isArray(body.pages) ||
      !body.pages.every(page => page && Number.isSafeInteger(page.capture_id) && page.capture_id > 0 && (page.depth === undefined || isDepth(page.depth)) && isWebUrl(page.url) &&
        typeof page.title === "string" && Array.isArray(page.facts) && page.facts.every((fact: unknown) => typeof fact === "string")) ||
      !("attempts" in body) || !Array.isArray(body.attempts) || !body.attempts.every(attempt => attempt && typeof attempt.url === "string" &&
        ["captured", "failed"].includes(attempt.status) && (attempt.depth === undefined || isDepth(attempt.depth)) && (attempt.reason === undefined || typeof attempt.reason === "string")) ||
      ("error" in body && typeof body.error !== "string")) throw new Error("The walkthrough response could not be read. Refresh and try again.");
  return body as TWebsiteWalkthrough;
};

export const listWalkthroughs = async (projectId: string, signal: AbortSignal) => {
  const value = await (await request(walkthroughPath(projectId), { session_id: projectId }, undefined, { signal })).json();
  if (!Array.isArray(value?.walkthroughs)) throw new Error("The saved walkthroughs could not be read.");
  return value.walkthroughs.map(readWalkthrough) as TWebsiteWalkthrough[];
};

export const loadWalkthrough = async (projectId: string, id: string, signal: AbortSignal) =>
  readWalkthrough(await (await request(walkthroughPath(projectId, id), { session_id: projectId }, undefined, { signal })).json());

export const approveWalkthrough = async (projectId: string, input: TWebsiteWalkthroughInput) =>
  readWalkthrough(await (await request(walkthroughPath(projectId), { session_id: projectId }, input)).json());

export const downloadWalkthrough = async (projectId: string, id: string) => {
  const response = await request(`${walkthroughPath(projectId, id)}/powerpoint`, { session_id: projectId });
  const objectUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = "website-walkthrough.pptx";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
};
