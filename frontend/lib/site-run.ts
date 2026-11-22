import type { TSiteRun, TSiteRunInput } from "../../shared/site-run";
import { apiBase, request } from "./research";

const pathFor = (projectId: string, runId?: string) =>
  `/api/sessions/${encodeURIComponent(projectId)}/site-runs${runId ? `/${encodeURIComponent(runId)}` : ""}`;

const states = new Set(["queued", "running", "completed", "failed", "stopped"]);
export const isSiteRunUrl = (value: unknown) => {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  } catch { return false; }
};
const readRun = (body: unknown): TSiteRun => {
  const value = body as Partial<TSiteRun> | null;
  if (!value || typeof value.run_id !== "string" || !value.status || !states.has(value.status) || !isSiteRunUrl(value.url) ||
      typeof value.goal !== "string" || typeof value.audience !== "string" || typeof value.created_at !== "number" ||
      typeof value.max_depth !== "number" || typeof value.spent_usd !== "number" || typeof value.budget_usd !== "number" ||
      (value.receipts !== undefined && (!Array.isArray(value.receipts) || !value.receipts.every(receipt =>
        receipt && Number.isSafeInteger(receipt.n) && typeof receipt.model === "string" &&
        ["reserved", "failed", "completed"].includes(receipt.status) && Number.isFinite(receipt.priced_usd) &&
        typeof receipt.estimated === "boolean"))) ||
      !Array.isArray(value.steps) || !value.steps.every(step => step && Number.isSafeInteger(step.n) && isSiteRunUrl(step.url) &&
        typeof step.title === "string" && typeof step.caption === "string" && Array.isArray(step.facts) && step.facts.every(fact => typeof fact === "string")) ||
      !Array.isArray(value.activity) || !value.activity.every(item => item && Number.isSafeInteger(item.n) && typeof item.label === "string") ||
      !value.coverage || !Array.isArray(value.coverage.visited) || !value.coverage.visited.every(isSiteRunUrl) || !Array.isArray(value.coverage.walls) ||
      (value.coverage.remaining !== undefined && (!Array.isArray(value.coverage.remaining) ||
        !value.coverage.remaining.every(item => item && isSiteRunUrl(item.url) && typeof item.label === "string"))) ||
      !value.coverage.walls.every(wall => wall && isSiteRunUrl(wall.url) && typeof wall.label === "string" && typeof wall.reason === "string")) {
    throw new Error("Couldn’t read the saved walkthrough. Refresh and try again.");
  }
  return value as TSiteRun;
};

export const listSiteRuns = async (projectId: string, signal: AbortSignal) => {
  const body = await (await request(pathFor(projectId), { session_id: projectId }, undefined, { signal })).json();
  if (!Array.isArray(body?.runs)) throw new Error("Couldn’t read the saved walkthroughs.");
  return body.runs.map(readRun) as TSiteRun[];
};

export const readSiteRun = async (projectId: string, runId: string, signal: AbortSignal) =>
  readRun(await (await request(pathFor(projectId, runId), { session_id: projectId }, undefined, { signal })).json());

export const startSiteRun = async (projectId: string, input: TSiteRunInput) =>
  readRun(await (await request(pathFor(projectId), { session_id: projectId }, input)).json());

export const stopSiteRun = async (projectId: string, runId: string) =>
  readRun(await (await request(pathFor(projectId, runId) + "/stop", { session_id: projectId }, {})).json());

export const siteStepImage = (projectId: string, runId: string, n: number) => `${apiBase}${pathFor(projectId, runId)}/steps/${n}/screenshot`;

export const attachSiteRun = async (projectId: string, runId: string) => {
  const body = await (await request(pathFor(projectId, runId) + "/source", { session_id: projectId }, {})).json();
  if (typeof body?.source_id !== "string") throw new Error("Couldn’t add the walkthrough to this project.");
  return body.source_id as string;
};

export const downloadSiteRun = async (projectId: string, runId: string) => {
  const response = await request(pathFor(projectId, runId) + "/powerpoint", { session_id: projectId });
  const objectUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = "agent-walkthrough.pptx";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
};
