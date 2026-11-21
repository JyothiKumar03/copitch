import type { Database } from "bun:sqlite";

type TStudioChange = "sources" | "job" | "conversation";
type TStudioUpdate = { seq: number; kind: TStudioChange; resource_id: string };

const listeners = new Map<string, Set<() => void>>();
const queued = new Set<string>();

export const record_studio_update = (db: Database, session: string, kind: TStudioChange, resource_id: string) => {
  db.query("INSERT OR REPLACE INTO studio_updates (session, kind, resource_id) VALUES (?, ?, ?)")
    .run(session, kind, resource_id);
  if (!listeners.has(session) || queued.has(session)) return;
  queued.add(session);
  // The synchronous SQLite transaction finishes before subscribers can read its resulting state.
  queueMicrotask(() => {
    queued.delete(session);
    for (const notify of listeners.get(session) ?? []) notify();
  });
};

export const subscribe_studio = (session: string, notify: () => void) => {
  const group = listeners.get(session) ?? new Set<() => void>();
  group.add(notify);
  listeners.set(session, group);
  return () => {
    group.delete(notify);
    if (!group.size) listeners.delete(session);
  };
};

export class StudioUpdates {
  constructor(private db: Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS studio_updates (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, session TEXT NOT NULL, kind TEXT NOT NULL,
      resource_id TEXT NOT NULL, UNIQUE(session, kind, resource_id));
      CREATE INDEX IF NOT EXISTS studio_updates_session_seq ON studio_updates(session, seq);`);
  }

  latest(session: string) {
    return this.db.query<{seq: number}, [string]>(
      "SELECT COALESCE(MAX(seq), 0) AS seq FROM studio_updates WHERE session=?").get(session)!.seq;
  }

  after(session: string, seq: number) {
    return this.db.query<TStudioUpdate, [string, number]>(
      "SELECT seq, kind, resource_id FROM studio_updates WHERE session=? AND seq>? ORDER BY seq LIMIT 128")
      .all(session, seq);
  }
}
