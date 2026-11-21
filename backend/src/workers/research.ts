import { job_trace } from "../middleware/trace";
import { AppError } from "../errors/app-error";
import type { SessionStore } from "../repositories/session";
import type { TResearchProvider } from "../types/research";
import { build_research } from "../services/research";

export class ResearchWorker {
  private running = false;
  private timer?: ReturnType<typeof setInterval>;

  constructor(private store: () => SessionStore, private provider: () => TResearchProvider) {}

  // Leases fence workers across processes. Limit this instance to one provider pipeline at a time.
  async tick(id?: string) {
    if (this.running) return;
    this.running = true;
    try {
      const db = this.store();
      const jobs = db.research_jobs;
      const lease = jobs.claim(id);
      if (!lease) return;
      const started = performance.now();
      const correlation = { job_id: lease.job_id, attempt: lease.attempts + 1 };
      const elapsed = () => Math.round(performance.now() - started);
      job_trace({ ...correlation, operation: "research.attempt", status: "started", duration_ms: 0 });
      const abort = new AbortController();
      const refresh = setInterval(() => {
        try {
          if (!jobs.renew(lease)) abort.abort();
        } catch { abort.abort(); }
      },4000);
      refresh.unref();
      try {
        const brief = db.current_brief(lease.session_id);
        jobs.assert_owner(lease);
        if (!brief || brief.brief_id !== lease.brief_id) throw new Error("Research scope changed");
        const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(brief.studio_version === 2 ? 240_000 : 90_000)]);
        const bundle = await build_research(brief,this.provider(),signal,() => jobs.assert_owner(lease),
          lease.checkpoint,state => jobs.checkpoint(lease,state),
          db.sources.selected(lease.session_id, brief.sources?.map(s => s.source_id) ?? []),
          (kind, label) => {
            jobs.record(lease, kind, label);
            job_trace({ ...correlation, operation: "research.activity", status: kind, duration_ms: elapsed() });
          });
        jobs.complete(lease,bundle);
        job_trace({ ...correlation, operation: "research.attempt", status: "completed", duration_ms: elapsed() });
      } catch (error) {
        if (error instanceof AppError && error.status === 422) {
          jobs.request_input(lease, error.message);
          job_trace({ ...correlation, operation: "research.attempt", status: "needs_input", duration_ms: elapsed() });
          return;
        }
        job_trace({ ...correlation, operation: "research.attempt", status: "interrupted", duration_ms: elapsed() });
        jobs.fail(lease,error instanceof AppError && error.status === 503 ? error.message : "Research worker failed");
      } finally {
        clearInterval(refresh);
      }
    } finally {
      this.running = false;
    }
  }

  wake(id?: string) {
    void this.tick(id).catch(() => console.error("Research queue unavailable"));
  }

  start() {
    if (this.timer) return;
    this.wake();
    this.timer = setInterval(() => this.wake(),1000);
    this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
