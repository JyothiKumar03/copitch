import { AppError } from "../errors/app-error";
import type { SessionStore } from "../repositories/session";
import { prepare_reviewed_deck } from "../services/deck-render-review";

export class DeckPreparationWorker {
  private running = false;
  private timer?: ReturnType<typeof setInterval>;

  constructor(private store: () => SessionStore, private prepare = prepare_reviewed_deck) {}

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
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(240_000)]);
      const refresh = setInterval(() => {
        try {
          if (signal.aborted || !jobs.renew(lease)) controller.abort();
        } catch { controller.abort(); }
      }, 5_000);
      refresh.unref();
      try {
        const bundle = db.research_by_id(lease.session_id, lease.research_id);
        if (!bundle) throw new AppError(404, "The saved research is unavailable.");
        const deck = await this.prepare(bundle, { slide_count: lease.slide_count }, undefined, {
          signal,
          before_render: () => {
            signal.throwIfAborted();
            if (!jobs.consume_render_pass(lease)) throw new AppError(503, "The slide preparation lease or review budget expired. Try again.");
          },
        });
        signal.throwIfAborted();
        if (jobs.complete(lease, deck)) trace("completed");
      } catch (error) {
        const reason = error instanceof AppError ? error.message : "Slide preparation was interrupted. Try again.";
        const status = error instanceof AppError ? error.status : 503;
        if (jobs.fail(lease, reason, status)) trace("failed");
      } finally {
        clearInterval(refresh);
      }
    } finally {
      this.running = false;
    }
  }

  wake() {
    void this.tick().catch(error => console.error("Slide preparation queue unavailable:", error instanceof Error ? error.message : error));
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.wake(), 1000);
    this.timer.unref();
  }
}
