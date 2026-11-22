import { commit_mission_result, with_mission_job } from "../services/mission-metering";
import { AppError } from "../errors/app-error";
import type { SessionStore } from "../repositories/session";
import type { TDeckPreparationFailure, TDeckPreparationPhase } from "../../../shared/presentation";
import type { TSlide } from "../types/deck";
import { DeckPreparationError } from "../services/deck-preparation-failure";
import { prepare_reviewed_deck } from "../services/deck-render-review";
import { PresentationCoverageError, select_presentation_evidence } from "../services/presentation-planner";
import { decide_presentation_readiness } from "../services/presentation-readiness";
import { research_for_presentation } from "../services/presentation-research";
import type { TPresentationResearchCheckpoint } from "../services/presentation-research";

const default_coverage_services = { decide: decide_presentation_readiness, research: research_for_presentation };

export class DeckPreparationWorker {
  private running = false;
  private timer?: ReturnType<typeof setInterval>;

  constructor(private store: () => SessionStore, private prepare = prepare_reviewed_deck,
    private coverage_services = default_coverage_services) {}

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const db = this.store();
      const jobs = db.deck_preparations;
      const lease = jobs.claim();
      if (!lease) return;
      const started = performance.now();
      const trace = (status: string) => {
        if (process.env.TRACE_LOGS === "1") console.log(JSON.stringify({ operation: "deck.preparation",
          job_id: lease.job_id, status, duration_ms: Math.round(performance.now() - started) }));
      };
      trace("started");
      const controller = new AbortController();
      let signal = AbortSignal.any([controller.signal, AbortSignal.timeout(330_000)]);
      const refresh = setInterval(() => {
        try {
          if (signal.aborted || !jobs.renew(lease)) controller.abort();
        } catch { controller.abort(); }
      }, 5_000);
      refresh.unref();
      let verified_slides: TSlide[] = [];
      try {
        const meter = db.missions.mission_meter(lease.session_id, lease.job_id);
        const bundle = db.research_by_id(lease.session_id, lease.research_id);
        if (!bundle) throw new AppError(404, "The saved research is unavailable.");
        const original_ids = new Set(bundle.evidence.map(row => row.id));
        const count = lease.slide_count;
        const check_current = () => {
          signal.throwIfAborted();
          if (!jobs.owns(lease)) throw new AppError(503, "Slide preparation was interrupted. Try again.");
        };
        const phase = (value: TDeckPreparationPhase) => {
          signal.throwIfAborted();
          if (!jobs.set_phase(lease, value)) throw new AppError(503, "Slide preparation was interrupted. Try again.");
          trace(value);
        };
        const decide = async (evidence: typeof bundle) => {
          phase("checking_evidence");
          try {
            return await this.coverage_services.decide(evidence, count, signal);
          } catch (error) {
            signal.throwIfAborted();
            if (!(error instanceof AppError) || error.status !== 503) throw error;
            // The readiness check is advisory. When Decisions is unreachable, the exact-count planner,
            // independent fact check and render review still decide whether the deck can be published.
            trace("readiness_unavailable");
            return { probability: 0, ready: true, gaps: [] };
          }
        };
        const prepare = async (evidence: typeof bundle) => {
          phase("planning_slides");
          const deck = await this.prepare(evidence, { slide_count: count }, undefined, {
            signal,
            before_render: () => {
              phase("reviewing_slides");
              if (!jobs.consume_render_pass(lease)) throw new AppError(503, "The slide preparation lease or review budget expired. Try again.");
            },
          });
          return { deck, supplemental: evidence.evidence.filter(row => !original_ids.has(row.id)) };
        };
        const evidence_error = (gaps: string[]) => new DeckPreparationError("insufficient_evidence", [
          `There isn’t enough evidence for ${count} slides yet. Add sources and run research again, or choose fewer slides.`,
          ...gaps.slice(0, 2),
        ].join(" "), gaps);
        const recover = async (coverage: TPresentationResearchCheckpoint) => {
          if (bundle.confirmed_brief.source_policy !== "public_search") throw evidence_error(coverage.gaps);
          phase("researching_gaps");
          if (!jobs.checkpoint_coverage(lease, coverage)) check_current();
          const supplemented = await this.coverage_services.research(bundle, count, coverage,
            AbortSignal.any([signal, AbortSignal.timeout(90_000)]), check_current, collection => {
              if (!jobs.checkpoint_coverage(lease, { gaps: coverage.gaps, collection })) check_current();
            });
          const verdict = await decide(supplemented);
          if (!verdict.ready) throw evidence_error(verdict.gaps);
          return prepare(supplemented);
        };
        const run = async () => {
          if (lease.coverage_checkpoint) return recover(JSON.parse(lease.coverage_checkpoint) as TPresentationResearchCheckpoint);
          const verdict = await decide(bundle);
          if (!verdict.ready) {
            if (bundle.confirmed_brief.source_policy === "public_search") return recover({ gaps: verdict.gaps });
            if (!select_presentation_evidence(bundle).length) throw evidence_error(verdict.gaps);
            // The low-confidence route cannot look up public material in a files-only project. Let the
            // exact-count planner and independent verifier test the actual saved evidence.
            return prepare(bundle);
          }
          try {
            return await prepare(bundle);
          } catch (error) {
            if (!(error instanceof PresentationCoverageError)) throw error;
            verified_slides = error.verified_slides;
            return recover({ gaps: error.gaps });
          }
        };
        const { deck, supplemental } = await with_mission_job(meter, scoped_signal => {
          signal = scoped_signal;
          return run();
        }, signal);
        signal.throwIfAborted();
        if (commit_mission_result(db.missions, meter, () => jobs.complete(lease, deck, Date.now(), supplemental))) trace("completed");
      } catch (error) {
        const reason = error instanceof AppError ? error.message : "Slide preparation was interrupted. Try again.";
        const status = error instanceof AppError ? error.status : 503;
        const detail = error instanceof DeckPreparationError ? error : undefined;
        const failure: TDeckPreparationFailure = { reason_code: detail?.reason_code ?? (status === 503 ? "provider_unavailable" : "preparation_failed"),
          message: reason, gaps: [...new Set(detail?.gaps ?? [])], supported_slide_count: 0 };
        const partial = detail?.verified_slides ?? [];
        if (jobs.fail(lease, failure, status, partial.length >= verified_slides.length ? partial : verified_slides)) trace("failed");
      } finally {
        clearInterval(refresh);
      }
    } finally {
      this.running = false;
    }
  }

  wake() {
    void this.tick().catch(error => console.error("Slide preparation queue unavailable:", error instanceof Error ? error.name : "UnknownError"));
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.wake(), 1000);
    this.timer.unref();
  }
}
