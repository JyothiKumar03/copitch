import type { Database } from "bun:sqlite";
import type { DeckRepository } from "./deck";
import type { TDeck } from "../types/deck";
import { MAX_DECK_REVIEW_PASSES } from "../../../shared/presentation";

type TPreparationStatus = "queued" | "running" | "completed" | "failed";
type TPreparationRow = {
  job_id: string; status: TPreparationStatus; deck_id: string | null;
  error: string | null; error_status: number | null;
};
export type TDeckPreparation = {
  job_id: string; status: TPreparationStatus; deck?: TDeck; error?: string; error_status?: number;
};
export type TDeckPreparationLease = {
  job_id: string; session_id: string; research_id: string; variant: string; slide_count: number; lease_token: string;
};
const lease_ms = 30_000;
const max_attempts = 2;
const max_active = 2;

export class DeckPreparationRepository {
  constructor(private db: Database, private decks: DeckRepository) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS deck_preparations (
        job_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, research_id TEXT NOT NULL, variant TEXT NOT NULL,
        slide_count INTEGER NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        render_rounds INTEGER NOT NULL DEFAULT 0,
        lease_token TEXT, lease_until INTEGER, deck_id TEXT, error TEXT, error_status INTEGER);
      CREATE UNIQUE INDEX IF NOT EXISTS deck_active_preparation ON deck_preparations(session_id,research_id,variant)
        WHERE status IN ('queued','running','completed');
      CREATE INDEX IF NOT EXISTS deck_preparation_queue ON deck_preparations(status,lease_until);
    `);
    // CREATE TABLE IF NOT EXISTS never adds columns to a table from an earlier version. Without this, every claim fails
    // on the missing column and queued decks wait forever.
    const columns = db.query<{ name: string }, []>("PRAGMA table_info(deck_preparations)").all();
    if (!columns.some(column => column.name === "render_rounds")) {
      db.exec("ALTER TABLE deck_preparations ADD COLUMN render_rounds INTEGER NOT NULL DEFAULT 0");
    }
  }

  enqueue(session: string, research: string, variant: string, slide_count: number) {
    return this.db.transaction(() => {
      const deck = this.decks.for_research(session, research, variant);
      if (deck) return { deck };
      const active = this.db.query<{ job_id: string; status: "queued" | "running" }, [string,string,string]>(`
        SELECT job_id,status FROM deck_preparations WHERE session_id=? AND research_id=? AND variant=? AND status IN ('queued','running')
      `).get(session, research, variant);
      if (active) return { job: active };
      const job_id = crypto.randomUUID();
      this.db.query(`INSERT INTO deck_preparations(job_id,session_id,research_id,variant,slide_count,status)
        VALUES(?,?,?,?,?,'queued')`).run(job_id, session, research, variant, slide_count);
      return { job: { job_id, status: "queued" as const } };
    }).immediate();
  }

  get(session: string, id: string): TDeckPreparation | undefined {
    const row = this.db.query<TPreparationRow, [string,string]>(`
      SELECT job_id,status,deck_id,error,error_status FROM deck_preparations WHERE session_id=? AND job_id=?
    `).get(session, id);
    if (!row) return;
    const deck = row.deck_id ? this.decks.get(session, row.deck_id, 1) : undefined;
    return { job_id: row.job_id, status: row.status, ...(deck && { deck }),
      ...(row.error && { error: row.error }), ...(row.error_status && { error_status: row.error_status }) };
  }

  claim(now = Date.now()): TDeckPreparationLease | undefined {
    return this.db.transaction(() => {
      this.db.query(`UPDATE deck_preparations SET status='failed', lease_token=NULL, lease_until=NULL, error_status=503,
        error='Slide preparation was interrupted. Try again.' WHERE status='running' AND lease_until<=?
        AND (attempts>=? OR render_rounds>0)`).run(now,max_attempts);
      this.db.query(`UPDATE deck_preparations SET status='queued', lease_token=NULL, lease_until=NULL
        WHERE status='running' AND lease_until<=?`).run(now);
      const active = this.db.query<{ total: number }, []>("SELECT count(*) total FROM deck_preparations WHERE status='running'").get();
      if (active && active.total >= max_active) return;
      return this.db.query<TDeckPreparationLease, [string,number]>(`
        UPDATE deck_preparations SET status='running', attempts=attempts+1, lease_token=?, lease_until=?
        WHERE job_id=(SELECT job_id FROM deck_preparations WHERE status='queued' ORDER BY rowid LIMIT 1)
        RETURNING job_id,session_id,research_id,variant,slide_count,lease_token
      `).get(crypto.randomUUID(), now + lease_ms) ?? undefined;
    }).immediate();
  }

  renew(lease: TDeckPreparationLease, now = Date.now()) {
    return this.db.query(`UPDATE deck_preparations SET lease_until=?
      WHERE job_id=? AND status='running' AND lease_token=? AND lease_until>?`)
      .run(now + lease_ms, lease.job_id, lease.lease_token, now).changes === 1;
  }

  consume_render_pass(lease: TDeckPreparationLease, now = Date.now()) {
    return this.db.query(`UPDATE deck_preparations SET render_rounds=render_rounds+1
      WHERE job_id=? AND status='running' AND lease_token=? AND lease_until>? AND render_rounds<?`)
      .run(lease.job_id, lease.lease_token, now, MAX_DECK_REVIEW_PASSES).changes === 1;
  }

  complete(lease: TDeckPreparationLease, candidate: TDeck, now = Date.now()) {
    return this.db.transaction(() => {
      if (!this.db.query(`SELECT 1 FROM deck_preparations WHERE job_id=? AND status='running' AND lease_token=? AND lease_until>?`)
        .get(lease.job_id, lease.lease_token, now)) return false;
      const snapshot = this.decks.create(lease.session_id, candidate, lease.variant);
      this.db.query(`UPDATE deck_preparations SET status='completed',deck_id=?,lease_token=NULL,lease_until=NULL WHERE job_id=?`)
        .run(snapshot.deck_id, lease.job_id);
      return true;
    }).immediate();
  }

  fail(lease: TDeckPreparationLease, error: string, status: number, now = Date.now()) {
    return this.db.query(`UPDATE deck_preparations SET status='failed',error=?,error_status=?,lease_token=NULL,lease_until=NULL
      WHERE job_id=? AND status='running' AND lease_token=? AND lease_until>?`)
      .run(error,status,lease.job_id,lease.lease_token,now).changes === 1;
  }
}
