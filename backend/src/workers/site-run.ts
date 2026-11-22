import type { SessionStore } from "../repositories/session";
import { configured_site_decider, run_site_agent, site_run_limits } from "../services/site-agent";
import { until_aborted } from "../services/website-capture";
import { AppError } from "../errors/app-error";

export class SiteRunWorker {
  private running = false;
  private timer?: ReturnType<typeof setInterval>;
  private active?: { id: string; abort: AbortController };

  constructor(private store: () => SessionStore, private run = run_site_agent, private decider = configured_site_decider) {}

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const jobs = this.store().site_runs;
      const lease = jobs.claim();
      if (!lease) return;
      const abort = new AbortController();
      this.active = { id: lease.run_id, abort };
      const remaining = Math.max(1, lease.created_at + site_run_limits.time_ms - Date.now());
      const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(remaining)]);
      const heartbeat = setInterval(() => { if (!jobs.owns(lease)) abort.abort(); }, 250);
      const renew = setInterval(() => { if (!jobs.renew(lease)) abort.abort(); }, 5_000);
      heartbeat.unref(); renew.unref();
      try {
        const decider = lease.engine === "model" ? this.decider() : undefined;
        if (!decider && lease.engine === "model" && !jobs.use_browser_fallback(lease)) return;
        const result = await until_aborted(this.run(lease, signal, (state, image) => {
          if (!jobs.checkpoint(lease, state, image)) abort.abort();
        }, { decider }), signal);
        signal.throwIfAborted();
        if (result.checkpoint.steps.length) jobs.complete(lease, result.summary);
        else jobs.fail(lease, result.summary);
      } catch (error) {
        const message = error instanceof AppError ? error.message : signal.aborted
          ? "The walkthrough reached its time limit. Your saved steps are still available."
          : "The browser could not finish. Your saved steps are still available.";
        jobs.fail(lease, message);
      } finally {
        clearInterval(heartbeat); clearInterval(renew);
        this.active = undefined;
      }
    } finally { this.running = false; }
  }

  stop(id: string) {
    if (this.active?.id === id) this.active.abort.abort();
  }

  wake() {
    void this.tick().catch(() => console.error("Agent walkthrough queue unavailable."));
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.wake(), 1_000);
    this.timer.unref();
  }
}
