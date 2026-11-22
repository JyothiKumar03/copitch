import { createHash } from "node:crypto";
import { AppError } from "../errors/app-error";
import type { SessionStore } from "../repositories/session";
import { mission_step } from "../repositories/mission";
import { pitch_variant_key } from "../repositories/deck";
import type { TMission, TMissionRetry, TMissionRetryPhase } from "../types/mission";
import { DEFAULT_PRESENTATION_SLIDES } from "../../../shared/presentation";
import { configured_models_for } from "./model-config";

const stage_name = { research: "Research", preparation: "Slide preparation", plan: "The Director", review: "The outcome review" };
export const mission_interruption = (phase: TMissionRetryPhase) => `${stage_name[phase]} paused because a service is unavailable. Your approved plan and saved work are intact.`;
const raw_provider_error = /(?:OPENAI_(?:API_KEY|TEXT_MODELS|BASE_URL)|API key|Connect a priced Director model|Configure .*provider)/iu;

const phase_for = (db: SessionStore, session: string, m: TMission): TMissionRetryPhase | undefined => {
  if (m.status !== "needs_input" || m.approved_revision !== m.contract.revision || !m.started_at || !m.brief_id ||
      db.current_brief(session)?.brief_id !== m.brief_id) return;
  const job = m.research_job_id && db.research_jobs.get(session,m.research_job_id);
  if (!job || job.brief_id !== m.brief_id) return;
  if (job.status === "failed") return "research";
  if (job.status !== "completed" || !job.result || job.result.research_id !== m.research_id) return;
  const preparation = m.deck_job_id && db.deck_preparations.get(session,m.deck_job_id);
  if (preparation && preparation.status === "failed") {
    const code = preparation.failure?.reason_code;
    if (code === "provider_unavailable" || code === "interrupted" ||
        code === "preparation_failed" && (preparation.error_status ?? 0) >= 500) return "preparation";
  }
  return db.missions.failed_model_phase(m);
};

const has_allowance = (m: TMission) => !!m.started_at && Date.now() < m.started_at + m.contract.budget.minutes * 60000 &&
  m.spent_usd + m.reserved_usd < m.contract.budget.usd &&
  m.steps.filter(step => ["research","browse_site","prepare_deck","check_outcome","ask_host"].includes(step.tool)).length < 24;

export const mission_view = (db: SessionStore, session: string, m: TMission): TMission => {
  const phase = phase_for(db,session,m);
  let retry: TMissionRetry | null = null;
  let gaps = m.gaps.map(text => raw_provider_error.test(text) ? mission_interruption("research") : text);
  if (phase) {
    gaps = [mission_interruption(phase)];
    const current = db.missions.current(session);
    if (current?.mission_id === m.mission_id && current.contract.revision === m.contract.revision &&
        has_allowance(m) && !db.missions.retry_recorded(m,phase)) {
      const retry_id = createHash("sha256").update(JSON.stringify([m.mission_id,m.contract.revision,phase,m.research_job_id,m.deck_job_id])).digest("hex");
      retry = { phase,retry_id };
    } else if (!has_allowance(m)) gaps.unshift("The approved allowance has ended. Open your saved work or start a new outcome.");
    else if (db.missions.retry_recorded(m,phase)) gaps.push("This step already used its retry. Review your saved work or add content.");
  }
  const steps = m.steps.map(step => raw_provider_error.test(step.summary) ? { ...step, summary: mission_interruption(phase ?? "research") } : step);
  return { ...m, gaps, steps, retry };
};

export const ensure_retry_provider = (phase: TMissionRetryPhase, models = configured_models_for, connected = !!process.env.OPENAI_API_KEY?.trim()) => {
  const purpose = phase === "preparation" ? "planning" : phase === "research" ? "research" : "director";
  try {
    const candidates = models(purpose);
    const priced = purpose === "director" ? candidates.some(candidate => !!candidate.pricing) : !!candidates[0]?.pricing;
    if (connected && priced) return;
  } catch { /* A malformed or unavailable configuration cannot authorize a provider call. */ }
  throw new AppError(503,`${stage_name[phase]} is still unavailable. Try again when the service is connected. Your remaining budget is unchanged.`);
};

export const retry_mission = (db: SessionStore, session: string, id: string, revision: number, retry_id: string,
  ensure_available = ensure_retry_provider) => db.missions.change(session,id,revision,m => {
  if (db.missions.replay_retry(m,retry_id)) return;
  const retry = mission_view(db,session,m).retry;
  if (!retry || retry.retry_id !== retry_id) throw new AppError(409,"This retry is no longer available. Reopen the current plan and its saved work.");
  ensure_available(retry.phase);
  if (retry.phase === "research") {
    const job = db.research_jobs.enqueue(session,m.brief_id!,true);
    if (job.job_id !== m.research_job_id || job.status !== "queued") throw new AppError(409,"Research changed. Reopen the mission.");
  }
  if (retry.phase === "preparation") {
    const count = m.contract.deliverable.slide_count === "auto" ? DEFAULT_PRESENTATION_SLIDES : m.contract.deliverable.slide_count;
    const prepared = db.deck_preparations.enqueue(session,m.research_id!,pitch_variant_key({ slide_count: count }),count);
    if (prepared.deck) { m.deck_id = prepared.deck.deck_id; m.deck_revision = prepared.deck.revision; m.deck_job_id = null; }
    else if (prepared.job) { m.deck_job_id = prepared.job.job_id; db.missions.bind(session,m,prepared.job.job_id); }
  }
  db.missions.record_retry(m,retry.phase,retry_id);
  m.status = "working";
  m.gaps = [];
  mission_step(m,"resume",`Retrying ${stage_name[retry.phase].toLowerCase()} from the approved checkpoint.`);
});
