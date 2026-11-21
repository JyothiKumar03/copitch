import type { TWebsiteCaptureAttempt } from "../../../shared/website-walkthrough";
import { AppError } from "../errors/app-error";
import type { SessionStore } from "../repositories/session";
import { capture_website } from "../services/website-capture";
import { export_website_powerpoint } from "../services/website-powerpoint";

export class WebsiteWalkthroughWorker {
  private running = false;
  private timer?: ReturnType<typeof setInterval>;

  constructor(private store: () => SessionStore, private capture = capture_website, private export_deck = export_website_powerpoint) {}

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const jobs = this.store().website_walkthroughs;
      const lease = jobs.claim();
      if (!lease) return;
      const abort = new AbortController();
      const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(150_000)]);
      const renew = setInterval(() => {
        try { if (signal.aborted || !jobs.renew(lease)) abort.abort(); }
        catch { abort.abort(); }
      }, 5_000);
      renew.unref();
      try {
        const activity: TWebsiteCaptureAttempt[] = [];
        const captured = await this.capture(lease.url, signal, attempt => {
          activity.push(attempt);
          if (!jobs.progress(lease, activity)) abort.abort();
        }, undefined, { max_depth: lease.max_depth, goal: lease.goal });
        signal.throwIfAborted();
        if (!jobs.progress(lease, captured.attempts, Boolean(captured.pages.length))) return;
        if (!captured.pages.length) throw new AppError(422, "No pages could be captured. Check the starting URL and try a public page.");
        const pages = captured.pages.map((page, index) => ({ ...page, capture_id: index + 1 }));
        const powerpoint = await this.export_deck({ ...lease, pages, attempts: captured.attempts }, signal);
        signal.throwIfAborted();
        jobs.complete(lease, pages, powerpoint);
      } catch (error) {
        jobs.fail(lease, error instanceof AppError ? error.message : "The walkthrough could not finish. Start another walkthrough to retry.");
      } finally {
        clearInterval(renew);
      }
    } finally {
      this.running = false;
    }
  }

  wake() {
    void this.tick().catch(() => console.error("Website walkthrough queue unavailable."));
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.wake(), 1_000);
    this.timer.unref();
  }
}
