import type { TMission, TMissionStatus, TMissionStep, TOutcomeContract } from "../../shared/mission";
import { MAX_PRESENTATION_SLIDES } from "../../shared/presentation";
import type { TResearchSession } from "@/types/research";
import { request } from "./research";

const statuses = new Set<unknown>(["needs_approval", "working", "needs_input", "delivered", "stopped", "paused"] satisfies TMissionStatus[]);
const tools = new Set<unknown>(["set_contract", "research", "browse_site", "prepare_deck", "check_outcome", "ask_host", "stop", "take_over", "resume"] satisfies TMissionStep["tool"][]);
const retryPhases = new Set<unknown>(["research", "preparation", "plan", "review"]);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === "string";
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(string);
const nonnegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const revision = (value: unknown): value is number => nonnegative(value) && Number.isSafeInteger(value) && value >= 1;
const optional = (value: unknown, check: (value: unknown) => boolean) => value === null || check(value);
const isContract = (value: unknown): value is TOutcomeContract => {
  if (!record(value) || !string(value.contract_id) || !revision(value.revision) || !string(value.subject) || !string(value.audience) ||
    !string(value.purpose) || !strings(value.success_checks) || !Array.isArray(value.must_include) ||
    !value.must_include.every(fact => record(fact) && string(fact.text) && fact.source === "host")) return false;
  const { deliverable, sources, budget } = value;
  return record(deliverable) && deliverable.kind === "deck" &&
    (deliverable.slide_count === "auto" || (revision(deliverable.slide_count) && deliverable.slide_count <= MAX_PRESENTATION_SLIDES)) &&
    (deliverable.tone === undefined || string(deliverable.tone)) && (deliverable.max_minutes === undefined || nonnegative(deliverable.max_minutes)) &&
    record(sources) && strings(sources.urls) && strings(sources.files) && typeof sources.public_search === "boolean" &&
    (sources.materials === undefined || string(sources.materials)) &&
    Array.isArray(sources.site_tasks) && sources.site_tasks.every(task => record(task) && string(task.url) && string(task.goal) &&
      (task.mode === "read" || task.mode === "interact")) &&
    record(budget) && nonnegative(budget.usd) && nonnegative(budget.minutes);
};

const isMission = (value: unknown): value is TMission => record(value) && string(value.mission_id) && optional(value.proposal_id, string) &&
  statuses.has(value.status) && isContract(value.contract) && optional(value.previous_contract, isContract) && optional(value.started_at, nonnegative) &&
  optional(value.approved_revision, revision) && optional(value.deck_revision, revision) && nonnegative(value.spent_usd) && nonnegative(value.reserved_usd) &&
  [value.brief_id, value.research_job_id, value.research_id, value.deck_job_id, value.deck_id].every(id => optional(id, string)) &&
  (value.site_run_id === undefined || optional(value.site_run_id, string)) &&
  (value.retry === undefined || optional(value.retry, retry => record(retry) && string(retry.retry_id) && retryPhases.has(retry.phase))) &&
  strings(value.gaps) && Array.isArray(value.steps) && value.steps.every(step => record(step) && revision(step.sequence) &&
    tools.has(step.tool) && string(step.summary) && nonnegative(step.at) && revision(step.contract_revision));

const missionPath = (session: TResearchSession) => `/api/sessions/${encodeURIComponent(session.session_id)}/mission`;

export type TMissionCommand = { action: "approve" | "stop" | "take-over"; revision: number } |
  { action: "retry"; revision: number; retry_id: string } |
  { action: "revise"; revision: number; contract: TOutcomeContract };

export const missionKey = (sessionId: string | undefined) => ["host-mission", sessionId] as const;

export const readMission = async (session: TResearchSession, signal: AbortSignal): Promise<TMission | null> => {
  const body: unknown = await (await request(missionPath(session), session, undefined, { signal })).json();
  if (record(body) && (body.mission === null || isMission(body.mission))) return body.mission;
  throw new Error("Couldn’t read the mission. Refresh the project and try again.");
};

export const sendMissionCommand = async (session: TResearchSession, missionId: string, { action, ...command }: TMissionCommand): Promise<TMission> => {
  const body: unknown = await (await request(`${missionPath(session)}/${encodeURIComponent(missionId)}/${action}`, session, command)).json();
  if (record(body) && isMission(body.mission) && body.mission.mission_id === missionId) return body.mission;
  throw new Error("Couldn’t confirm the mission update. Refresh the project and check its current state.");
};
