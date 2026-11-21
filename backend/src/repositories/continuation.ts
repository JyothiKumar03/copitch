import type { Database } from "bun:sqlite";
import { ContinuationConflict, apply_continuation, create_continuation } from "../services/continuation";
import type { TContinuationEvent, TContinuationRole, TContinuationState, TPointSpec } from "../types/continuation";

export class ContinuationStore {
  constructor(private db: Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS continuation_snapshots (
        session TEXT NOT NULL, deck TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY(session,deck));
      CREATE TABLE IF NOT EXISTS continuation_events (
        seq INTEGER PRIMARY KEY, session TEXT NOT NULL, deck TEXT NOT NULL, id TEXT NOT NULL,
        role TEXT NOT NULL, event TEXT NOT NULL, result TEXT NOT NULL, UNIQUE(session,deck,id));
    `);
  }

  recover() {
    const rows = this.db.query<{session:string;deck:string;state:string}, []>(
      "SELECT session,deck,state FROM continuation_snapshots").all();
    for (const row of rows) {
      const current = JSON.parse(row.state) as TContinuationState;
      this.apply(row.session, row.deck, "host", {
        session_id: row.session, expected_revision: current.revision, generation: current.generation,
        event_id: crypto.randomUUID(), action: { kind: "reconnect" },
      });
    }
  }

  events(session: string, deck: string, after: number) {
    return this.db.query<{seq:number;role:TContinuationRole;event:string}, [string,string,number]>(
      "SELECT seq,role,event FROM continuation_events WHERE session=? AND deck=? AND seq>? ORDER BY seq LIMIT 256")
      .all(session, deck, after).map(row => ({ ...row, event: JSON.parse(row.event) as TContinuationEvent }));
  }

  get(session: string, deck: string): TContinuationState | undefined {
    const row = this.db.query<{state:string}, [string,string]>(
      "SELECT state FROM continuation_snapshots WHERE session=? AND deck=?").get(session, deck);
    return row ? JSON.parse(row.state) as TContinuationState : undefined;
  }

  private save(session: string, deck: string, state: TContinuationState) {
    this.db.query("INSERT OR REPLACE INTO continuation_snapshots(session,deck,state) VALUES(?,?,?)")
      .run(session, deck, JSON.stringify(state));
  }

  start(session: string, deck: string, revision: number, points: TPointSpec[]) {
    return this.db.transaction(() => {
      const existing = this.get(session, deck);
      if (existing?.revision === revision) return existing;
      if (existing && existing.revision > revision) throw new ContinuationConflict("Stale deck revision");
      const state = create_continuation(session, revision, points);
      this.save(session, deck, state);
      return state;
    }).immediate();
  }

  apply(session: string, deck: string, role: TContinuationRole, event: TContinuationEvent) {
    return this.db.transaction(() => {
      const previous = this.db.query<{role:string;event:string;result:string}, [string,string,string]>(
        "SELECT role,event,result FROM continuation_events WHERE session=? AND deck=? AND id=?")
        .get(session, deck, event.event_id);
      const encoded = JSON.stringify(event);
      if (previous) {
        if (previous.role !== role || previous.event !== encoded) throw new ContinuationConflict("Conflicting event ID");
        return JSON.parse(previous.result) as TContinuationState;
      }
      const current = this.get(session, deck);
      if (!current) throw new ContinuationConflict("Start continuation first");
      const next = apply_continuation(current, role, event);
      this.save(session, deck, next);
      this.db.query("INSERT INTO continuation_events(session,deck,id,role,event,result) VALUES(?,?,?,?,?,?)")
        .run(session, deck, event.event_id, role, encoded, JSON.stringify(next));
      return next;
    }).immediate();
  }
}
