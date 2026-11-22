import type { Database } from "bun:sqlite";
import type { TSiteRun, TSiteRunInput } from "../../../shared/site-run";
import { AppError } from "../errors/app-error";
import { initial_site_checkpoint } from "../services/site-agent";
import type { TSiteCheckpoint, TSiteLease } from "../types/site-run";

type TSiteRow = Omit<TSiteRun, "resumed" | "spent_usd" | "usage_estimated" | "goal_met" | "steps" | "activity" | "coverage" | "summary" | "has_powerpoint"> & {
  claim_count: number; checkpoint: string; summary: string | null; has_powerpoint: number;
};
const lease_ms = 25_000;
const retries = 2;
const columns = "run_id,url,audience,goal,max_depth,budget_usd,created_at,status,engine,claim_count,checkpoint,summary,powerpoint IS NOT NULL AS has_powerpoint";

const project = ({ claim_count, checkpoint, summary, has_powerpoint, ...row }: TSiteRow): TSiteRun => {
  const value = JSON.parse(checkpoint) as TSiteCheckpoint;
  return { ...row, ...(summary && { summary }), has_powerpoint: Boolean(has_powerpoint), resumed: claim_count > 1,
    spent_usd: value.spent_usd, receipts: value.receipts ?? [], usage_estimated: value.usage_estimated, goal_met: value.goal_met, steps: value.steps, activity: value.activity,
    coverage: { visited: value.visited, walls: value.walls, frontier: value.frontier.length,
      remaining: value.frontier.slice(0, 12).map(({ url, label }) => ({ url, label })) } };
};

export class SiteRunRepository {
  constructor(private db: Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS site_runs (
      run_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, request_id TEXT NOT NULL, url TEXT NOT NULL,
      audience TEXT NOT NULL, goal TEXT NOT NULL, max_depth INTEGER NOT NULL, budget_usd REAL NOT NULL,
      created_at INTEGER NOT NULL, status TEXT NOT NULL, engine TEXT NOT NULL, checkpoint TEXT NOT NULL,
      claim_count INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until INTEGER, summary TEXT, powerpoint BLOB,
      UNIQUE(session_id,request_id));
      CREATE UNIQUE INDEX IF NOT EXISTS site_runs_active ON site_runs(session_id) WHERE status IN ('queued','running');
      CREATE TABLE IF NOT EXISTS site_run_images (run_id TEXT NOT NULL, step INTEGER NOT NULL, screenshot BLOB NOT NULL, PRIMARY KEY(run_id,step));`);
  }

  list(session: string) {
    return this.db.query<TSiteRow, [string]>(`SELECT ${columns} FROM site_runs WHERE session_id=? ORDER BY rowid DESC LIMIT 24`).all(session).map(project);
  }

  get(session: string, id: string) {
    const row = this.db.query<TSiteRow, [string, string]>(`SELECT ${columns} FROM site_runs WHERE session_id=? AND run_id=?`).get(session, id);
    return row ? project(row) : undefined;
  }

  enqueue(session: string, input: TSiteRunInput, budget: number, engine: TSiteRun["engine"], now = Date.now()) {
    return this.db.transaction(() => {
      const repeated = this.db.query<TSiteRow, [string, string]>(`SELECT ${columns} FROM site_runs WHERE session_id=? AND request_id=?`).get(session, input.request_id);
      if (repeated) {
        if (repeated.url !== input.url || repeated.goal !== input.goal || repeated.audience !== input.audience || repeated.max_depth !== input.max_depth) {
          throw new AppError(409, "Review the changed walkthrough before approving it again.");
        }
        return project(repeated);
      }
      if (this.db.query("SELECT 1 FROM site_runs WHERE session_id=? AND status IN ('queued','running')").get(session)) {
        throw new AppError(409, "Finish or stop the current agent walkthrough first.");
      }
      const id = crypto.randomUUID();
      this.db.query(`INSERT INTO site_runs(run_id,session_id,request_id,url,audience,goal,max_depth,budget_usd,created_at,engine,status,checkpoint)
        VALUES(?,?,?,?,?,?,?,?,?,?,'queued',?)`).run(id, session, input.request_id, input.url, input.audience, input.goal, input.max_depth, budget,
          now, engine, JSON.stringify(initial_site_checkpoint(input.url)));
      return this.get(session, id)!;
    }).immediate();
  }

  claim(now = Date.now()) {
    return this.db.transaction(() => {
      // A terminal checkpoint records the result before the worker acknowledges it. Recover it without
      // starting a browser, changing its original engine, or consuming another execution attempt.
      this.db.query(`UPDATE site_runs SET status=CASE WHEN json_array_length(checkpoint,'$.steps')>0 THEN 'completed' ELSE 'failed' END,
        summary=json_extract(checkpoint,'$.final_summary'),claim_count=MAX(claim_count,2),lease_token=NULL,lease_until=NULL
        WHERE (status='queued' OR (status='running' AND lease_until<=?)) AND json_type(checkpoint,'$.final_summary')='text'`).run(now);
      this.db.query(`UPDATE site_runs SET status='failed',summary='The browser stopped. Your saved steps are still available.',lease_token=NULL,lease_until=NULL
        WHERE status='running' AND lease_until<=? AND claim_count>=?`).run(now, retries);
      this.db.query(`UPDATE site_runs SET status='queued',lease_token=NULL,lease_until=NULL WHERE status='running' AND lease_until<=?`).run(now);
      if (this.db.query("SELECT 1 FROM site_runs WHERE status='running' LIMIT 1").get()) return;
      const row = this.db.query<Omit<TSiteLease, "checkpoint"> & { checkpoint: string }, [string, number]>(`
        UPDATE site_runs SET status='running',claim_count=claim_count+1,lease_token=?,lease_until=?
        WHERE run_id=(SELECT run_id FROM site_runs WHERE status='queued' ORDER BY rowid LIMIT 1)
        RETURNING run_id,url,audience,goal,max_depth,budget_usd,created_at,engine,lease_token,checkpoint
      `).get(crypto.randomUUID(), now + lease_ms);
      return row ? { ...row, checkpoint: JSON.parse(row.checkpoint) as TSiteCheckpoint } : undefined;
    }).immediate();
  }

  owns(lease: TSiteLease, now = Date.now()) {
    return Boolean(this.db.query("SELECT 1 FROM site_runs WHERE run_id=? AND status='running' AND lease_token=? AND lease_until>?")
      .get(lease.run_id, lease.lease_token, now));
  }

  renew(lease: TSiteLease, now = Date.now()) {
    return this.db.query(`UPDATE site_runs SET lease_until=? WHERE run_id=? AND status='running' AND lease_token=? AND lease_until>?`)
      .run(now + lease_ms, lease.run_id, lease.lease_token, now).changes === 1;
  }

  use_browser_fallback(lease: TSiteLease, now = Date.now()) {
    return this.db.query(`UPDATE site_runs SET engine='browser' WHERE run_id=? AND status='running' AND lease_token=? AND lease_until>?`)
      .run(lease.run_id, lease.lease_token, now).changes === 1;
  }

  checkpoint(lease: TSiteLease, checkpoint: TSiteCheckpoint, image?: { n: number; bytes: Buffer }, now = Date.now()) {
    return this.db.transaction(() => {
      const updated = this.db.query(`UPDATE site_runs SET checkpoint=? WHERE run_id=? AND status='running' AND lease_token=? AND lease_until>?`)
        .run(JSON.stringify(checkpoint), lease.run_id, lease.lease_token, now);
      if (updated.changes !== 1) return false;
      if (image) this.db.query("INSERT OR IGNORE INTO site_run_images(run_id,step,screenshot) VALUES(?,?,?)").run(lease.run_id, image.n, image.bytes);
      return true;
    }).immediate();
  }

  captured(lease: TSiteLease) {
    if (!this.owns(lease)) return [];
    return this.db.query<{ capture_id: number; screenshot: Uint8Array }, [string]>(`
      SELECT step AS capture_id,screenshot FROM site_run_images WHERE run_id=? ORDER BY step
    `).all(lease.run_id);
  }

  private finish(lease: TSiteLease, status: "completed" | "failed", summary: string, powerpoint?: Buffer, now = Date.now()) {
    return this.db.query(`UPDATE site_runs SET status=?,summary=?,powerpoint=?,lease_token=NULL,lease_until=NULL
      WHERE run_id=? AND status='running' AND lease_token=? AND lease_until>?`).run(status, summary, powerpoint ?? null,
      lease.run_id, lease.lease_token, now).changes === 1;
  }

  complete(lease: TSiteLease, summary: string, powerpoint?: Buffer, now = Date.now()) {
    return this.finish(lease, "completed", summary, powerpoint, now);
  }

  fail(lease: TSiteLease, summary: string) {
    return this.finish(lease, "failed", summary);
  }

  stop(session: string, id: string) {
    this.db.query(`UPDATE site_runs SET status='stopped',summary='You stopped the walkthrough. Your saved steps are still available.',lease_token=NULL,lease_until=NULL
      WHERE session_id=? AND run_id=? AND status IN ('queued','running')`).run(session, id);
    return this.get(session, id);
  }

  attach_source<T>(session: string, id: string, attach: (run: TSiteRun) => T) {
    return this.db.transaction(() => {
      const run = this.get(session, id);
      if (!run) throw new AppError(404, "Walkthrough unavailable.");
      if (run.status === "running" || run.status === "queued" || !run.steps.length) {
        throw new AppError(409, "Finish or stop the walkthrough after it has recorded a step.");
      }
      return attach(run);
    }).immediate();
  }

  screenshot(session: string, id: string, n: number) {
    return this.db.query<{ screenshot: Uint8Array }, [string, string, number]>(`SELECT i.screenshot FROM site_run_images i
      JOIN site_runs r ON r.run_id=i.run_id WHERE r.session_id=? AND r.run_id=? AND i.step=?`).get(session, id, n)?.screenshot;
  }

  download(session: string, id: string) {
    return this.db.query<{ powerpoint: Uint8Array }, [string, string]>("SELECT powerpoint FROM site_runs WHERE session_id=? AND run_id=? AND status='completed'")
      .get(session, id)?.powerpoint;
  }
}
