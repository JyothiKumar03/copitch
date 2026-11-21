import type { Database } from "bun:sqlite";
import { AppError } from "../errors/app-error";
import type { TInterviewTurn } from "../types/research";
import { parse_state } from "../types/studio-turn";
import type { TStudioState, TStudioTurn } from "../types/studio-turn";
import { record_studio_update } from "../services/studio-events";

type TStudioSnapshot = { revision: number; context: unknown; prior_history: TInterviewTurn[] };

const stored_turn = (payload: string): TStudioTurn => {
  const turn = JSON.parse(payload) as TStudioTurn;
  return { ...turn, phase: turn.phase ?? "interview", proposal: turn.proposal ?? null };
};

export class StudioRepository {
  constructor(private db: Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS studio_context (
        session_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, context TEXT NOT NULL, prior_history TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS studio_turns (
        sequence INTEGER PRIMARY KEY, session_id TEXT NOT NULL, turn_id TEXT NOT NULL, request_hash TEXT NOT NULL,
        payload TEXT NOT NULL, UNIQUE(session_id,turn_id));
      CREATE INDEX IF NOT EXISTS studio_turns_history ON studio_turns(session_id,sequence);
    `);
  }

  snapshot(session: string): TStudioSnapshot | undefined {
    const row = this.db.query<{ revision: number; context: string; prior_history: string }, [string]>(
      "SELECT revision,context,prior_history FROM studio_context WHERE session_id=?").get(session);
    if (row) return { revision: row.revision, context: JSON.parse(row.context), prior_history: JSON.parse(row.prior_history) };
  }

  language_preference(session: string) {
    return parse_state(this.snapshot(session)?.context, false).reply_language ?? undefined;
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

  seed(session: string, context: TStudioState, prior_history: TInterviewTurn[]) {
    this.db.query("INSERT OR IGNORE INTO studio_context VALUES(?,0,?,?)")
      .run(session, JSON.stringify(context), JSON.stringify(prior_history));
  }

  hear_proposal(session: string, proposal_id: string, turn_id: string) {
    return this.db.transaction(() => {
      const state = parse_state(this.snapshot(session)?.context, false);
      if (state.phase !== "proposed" || state.proposal?.proposal_id !== proposal_id || state.proposal_turn_id !== turn_id) {
        throw new AppError(409, "This proposal is no longer open");
      }
      if (state.proposal_heard) return;
      state.proposal_heard = true;
      this.db.query("UPDATE studio_context SET context=? WHERE session_id=?").run(JSON.stringify(state), session);
      record_studio_update(this.db, session, "conversation", proposal_id);
    }).immediate();
  }

  replay(session: string, turn_id: string, request_hash: string): TStudioTurn | undefined {
    const found = this.turn(session, turn_id);
    if (!found) return;
    if (found.request_hash !== request_hash) throw new AppError(409, "Turn identity changed");
    return stored_turn(found.payload);
  }

  turns(session: string): TStudioTurn[] {
    return this.db.query<{ payload: string }, [string]>(
      "SELECT payload FROM studio_turns WHERE session_id=? ORDER BY sequence").all(session)
      .map(row => stored_turn(row.payload));
  }

  update_scope(session: string, expected: number, state: TStudioState, prior_history: TInterviewTurn[]) {
    return this.db.transaction(() => {
      if ((this.snapshot(session)?.revision ?? 0) !== expected) throw new AppError(409, "Project conversation changed. Reopen the project and try again.");
      this.save_state(session, expected + 1, state, prior_history);
      record_studio_update(this.db, session, "conversation", `scope-${expected + 1}`);
    }).immediate();
  }

  private save_state(session: string, revision: number, state: TStudioState, prior_history: TInterviewTurn[]) {
    this.db.query(`INSERT INTO studio_context VALUES(?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET
      revision=excluded.revision,context=excluded.context,prior_history=excluded.prior_history`)
      .run(session, revision, JSON.stringify(state), JSON.stringify(prior_history));
  }

  // A state change with no conversation turn, such as a plan set or research started from a live voice tool call.
  commit_state(session: string, expected: number, context: TStudioState, prior_history: TInterviewTurn[], apply: () => void) {
    return this.db.transaction(() => {
      if ((this.snapshot(session)?.revision ?? 0) !== expected) throw new AppError(409, "Project conversation changed. Reopen the project and try again.");
      apply();
      this.save_state(session, expected + 1, context, prior_history);
      record_studio_update(this.db, session, "conversation", `state-${expected + 1}`);
    }).immediate();
  }

  commit(session: string, expected: number, context: TStudioState, prior_history: TInterviewTurn[],
    request_hash: string, turn: TStudioTurn, apply: () => void): TStudioTurn {
    return this.db.transaction(() => {
      const replay = this.replay(session, turn.turn_id, request_hash);
      if (replay) return replay;
      if ((this.snapshot(session)?.revision ?? 0) !== expected) throw new AppError(409, "Project conversation changed. Reopen the project and try again.");
      apply();
      this.save_state(session, expected + 1, context, prior_history);
      this.db.query("INSERT INTO studio_turns(session_id,turn_id,request_hash,payload) VALUES(?,?,?,?)")
        .run(session, turn.turn_id, request_hash, JSON.stringify(turn));
      record_studio_update(this.db, session, "conversation", turn.turn_id);
      return turn;
    }).immediate();
  }
}
