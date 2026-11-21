import type { Database } from "bun:sqlite";
import { AppError } from "../errors/app-error";
import type { TInterviewTurn } from "../types/research";
import type { TStudioAsk, TStudioContext, TStudioTurn } from "../types/studio-turn";
import { record_studio_update } from "../services/studio-events";

type TStudioSnapshot = { revision: number; context: TStudioContext; prior_history: TInterviewTurn[] };

export class StudioRepository {
  constructor(private db: Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS studio_context (
        session_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, context TEXT NOT NULL, prior_history TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS studio_turns (
        sequence INTEGER PRIMARY KEY, session_id TEXT NOT NULL, turn_id TEXT NOT NULL, request_hash TEXT NOT NULL,
        payload TEXT NOT NULL, UNIQUE(session_id,turn_id));
      CREATE TABLE IF NOT EXISTS studio_question_playout (
        session_id TEXT PRIMARY KEY, request_id TEXT NOT NULL, turn_id TEXT NOT NULL, heard INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS studio_turns_history ON studio_turns(session_id,sequence);
    `);
  }

  snapshot(session: string): TStudioSnapshot | undefined {
    const row = this.db.query<{ revision: number; context: string; prior_history: string }, [string]>(
      "SELECT revision,context,prior_history FROM studio_context WHERE session_id=?").get(session);
    if (row) return { revision: row.revision, context: JSON.parse(row.context), prior_history: JSON.parse(row.prior_history) };
  }

  language_preference(session: string) {
    return this.snapshot(session)?.context.language_preference ?? undefined;
  }

  private turn(session: string, turn_id: string) {
    return this.db.query<{ payload: string; request_hash: string }, [string, string]>(
      "SELECT payload,request_hash FROM studio_turns WHERE session_id=? AND turn_id=?").get(session, turn_id);
  }

  reply(session: string, turn_id: string): string | undefined {
    const row = this.turn(session, turn_id);
    if (row) return (JSON.parse(row.payload) as TStudioTurn).text;
  }

  reply_language(session: string, turn_id: string) {
    const row = this.turn(session, turn_id);
    if (row) return (JSON.parse(row.payload) as TStudioTurn).language;
  }

  seed(session: string, context: TStudioContext, prior_history: TInterviewTurn[]) {
    this.db.query("INSERT OR IGNORE INTO studio_context VALUES(?,0,?,?)")
      .run(session, JSON.stringify(context), JSON.stringify(prior_history));
  }

  offer_question(session: string, turn_id: string) {
    const ask = this.snapshot(session)?.context.ask;
    if (ask?.turn_id !== turn_id) return;
    this.db.query(`INSERT INTO studio_question_playout(session_id,request_id,turn_id,heard) VALUES(?,?,?,0)
      ON CONFLICT(session_id) DO UPDATE SET request_id=excluded.request_id,turn_id=excluded.turn_id,heard=0`)
      .run(session, ask.request_id, turn_id);
  }

  acknowledge_question(session: string, request_id: string, turn_id: string) {
    const ask = this.snapshot(session)?.context.ask;
    if (ask?.request_id !== request_id || ask.turn_id !== turn_id) throw new AppError(409, "This question is no longer open");
    const result = this.db.query("UPDATE studio_question_playout SET heard=1 WHERE session_id=? AND request_id=? AND turn_id=?")
      .run(session, request_id, turn_id);
    if (!result.changes) throw new AppError(409, "Question audio was not offered for this turn");
  }

  heard_question(session: string, ask: TStudioAsk) {
    return !!this.db.query("SELECT 1 FROM studio_question_playout WHERE session_id=? AND request_id=? AND turn_id=? AND heard=1")
      .get(session, ask.request_id, ask.turn_id);
  }

  replay(session: string, turn_id: string, request_hash: string): TStudioTurn | undefined {
    const found = this.turn(session, turn_id);
    if (!found) return;
    if (found.request_hash !== request_hash) throw new AppError(409, "Turn identity changed");
    return JSON.parse(found.payload);
  }

  turns(session: string): TStudioTurn[] {
    return this.db.query<{ payload: string }, [string]>(
      "SELECT payload FROM studio_turns WHERE session_id=? ORDER BY sequence").all(session)
      .map(row => JSON.parse(row.payload));
  }

  commit(session: string, expected: number, context: TStudioContext, prior_history: TInterviewTurn[],
    request_hash: string, turn: TStudioTurn, apply: () => void): TStudioTurn {
    return this.db.transaction(() => {
      const replay = this.replay(session, turn.turn_id, request_hash);
      if (replay) return replay;
      if ((this.snapshot(session)?.revision ?? 0) !== expected) throw new AppError(409, "Project conversation changed. Reopen the project and try again.");
      apply();
      this.db.query(`INSERT INTO studio_context VALUES(?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET
        revision=excluded.revision,context=excluded.context,prior_history=excluded.prior_history`)
        .run(session, expected + 1, JSON.stringify(context), JSON.stringify(prior_history));
      this.db.query("INSERT INTO studio_turns(session_id,turn_id,request_hash,payload) VALUES(?,?,?,?)")
        .run(session, turn.turn_id, request_hash, JSON.stringify(turn));
      record_studio_update(this.db, session, "conversation", turn.turn_id);
      return turn;
    }).immediate();
  }
}
