import { AccountRepository } from "./accounts";
import { SourceRepository } from "./source";
import { StudioUpdates } from "../services/studio-events";
import { AudienceRepository } from "./audience";
import { ResearchJobRepository } from "./research-job";
import { DeckRepository } from "./deck";
import { StudioRepository } from "./studio";
import { ContinuationStore } from "./continuation";
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ModelMessage } from "ai";
import type { TResearchBrief, TResearchBundle } from "../types/research";
import type { TRun, TSessionEvent } from "../types/session";

// A single backend process owns this store. SQLite serializes each checkpoint and terminal event.
export class SessionStore {
  private db: Database;
  readonly accounts: AccountRepository;
  readonly sources: SourceRepository;
  readonly updates: StudioUpdates;
  readonly audience: AudienceRepository;
  readonly continuations: ContinuationStore;
  readonly research_jobs: ResearchJobRepository;
  readonly decks: DeckRepository;
  readonly studio: StudioRepository;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true, strict: true });
    this.updates = new StudioUpdates(this.db);
    this.accounts = new AccountRepository(this.db);
    this.sources = new SourceRepository(this.db);
    this.audience = new AudienceRepository(this.db);
    this.continuations = new ContinuationStore(this.db);
    this.continuations.recover();
    this.research_jobs = new ResearchJobRepository(this.db);
    this.decks = new DeckRepository(this.db);
    this.studio = new StudioRepository(this.db);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS ai_sessions (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ai_runs (id TEXT PRIMARY KEY, session TEXT NOT NULL,
        prompt TEXT NOT NULL, context TEXT NOT NULL, step INTEGER NOT NULL DEFAULT 0,
        messages TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'running');
      CREATE UNIQUE INDEX IF NOT EXISTS ai_active_session ON ai_runs(session) WHERE status='running';
      CREATE TABLE IF NOT EXISTS ai_events (seq INTEGER PRIMARY KEY, run TEXT NOT NULL, event TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS research_briefs (session TEXT PRIMARY KEY, id TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS research_bundles (id TEXT PRIMARY KEY, session TEXT NOT NULL, brief TEXT UNIQUE NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS ai_events_run ON ai_events(run, seq);
    `);
    const interrupted = this.db.query<{ id: string }, []>("SELECT id FROM ai_runs WHERE status='running'").all();
    for (const row of interrupted) this.finish(row.id, { type: "failed", reason: "Server restarted before completion" });
  }
  check_ready() {
    this.db.query("SELECT 1 FROM research_jobs LIMIT 1").get();
  }
  current_brief(session: string): TResearchBrief | undefined {
    const row = this.db.query<{payload: string}, [string]>("SELECT payload FROM research_briefs WHERE session=?").get(session);
    if (row) return JSON.parse(row.payload) as TResearchBrief;
  }
  replace_brief(session: string, expected: string | undefined, brief: TResearchBrief) {
    return this.db.transaction(() => {
      if (this.current_brief(session)?.brief_id !== expected) return false;
      this.db.query("INSERT OR REPLACE INTO research_briefs(session,id,payload) VALUES(?,?,?)")
        .run(session, brief.brief_id, JSON.stringify(brief));
      this.research_jobs.supersede(session, brief.brief_id);
      return true;
    })();
  }
  research_by_brief(session: string, brief: string): TResearchBundle | undefined {
    const row = this.db.query<{payload: string}, [string,string]>(
      "SELECT payload FROM research_bundles WHERE session=? AND brief=?").get(session,brief);
    if (row) return JSON.parse(row.payload) as TResearchBundle;
  }
  research_by_id(session: string, id: string): TResearchBundle | undefined {
    const row = this.db.query<{payload: string}, [string,string]>(
      "SELECT payload FROM research_bundles WHERE session=? AND id=?").get(session,id);
    if (row) return JSON.parse(row.payload) as TResearchBundle;
  }
  earlier_artifacts(session: string, current_brief: string) {
    return this.db.query<{ research_id: string; after_turn: number }, [string, string]>(
      `WITH snapshots AS (
         SELECT id, session, rowid AS sequence, COALESCE(json_array_length(payload, '$.confirmed_brief.history'), 1) AS turns
         FROM research_bundles WHERE session=? AND brief<>?
       )
       SELECT id AS research_id, MAX(0, turns - 1 + 2 * (
         SELECT COUNT(*) FROM research_progress_turns t WHERE t.session_id=snapshots.session AND t.after_turn<=turns
       )) AS after_turn FROM snapshots ORDER BY sequence`
    ).all(session, current_brief);
  }
  save_research(session: string, bundle: TResearchBundle) {
    return this.db.transaction(() => {
      if (this.current_brief(session)?.brief_id !== bundle.brief_id) return false;
      this.db.query("INSERT INTO research_bundles(id,session,brief,payload) VALUES(?,?,?,?)")
        .run(bundle.research_id, session, bundle.brief_id, JSON.stringify(bundle));
      return true;
    })();
  }
  add_session(id: string, hash: string) {
    this.db.query("INSERT INTO ai_sessions VALUES (?, ?)").run(id, hash);
  }
  authorized(id: string, hash: string) {
    return Boolean(this.db.query("SELECT 1 FROM ai_sessions WHERE id=? AND token_hash=?").get(id, hash));
  }
  start(session: string, prompt: string, context: string) {
    const id = crypto.randomUUID();
    const inserted = this.db.query("INSERT OR IGNORE INTO ai_runs(id,session,prompt,context) VALUES(?,?,?,?)")
      .run(id, session, prompt, context);
    return inserted.changes === 1 ? id : null;
  }
  get(session: string, id: string): TRun | null {
    const row = this.db.query<Omit<TRun, "messages"> & { messages: string }, [string, string]>(
      "SELECT * FROM ai_runs WHERE session=? AND id=?").get(session, id);
    return row && { ...row, messages: JSON.parse(row.messages) as ModelMessage[] };
  }
  recent(session: string) {
    return this.db.query<{ prompt: string; context: string; messages: string }, [string]>(
      "SELECT prompt,context,messages FROM ai_runs WHERE session=? AND status='completed' ORDER BY rowid DESC LIMIT 8").all(session);
  }
  checkpoint(id: string, step: number, messages: ModelMessage[]) {
    this.db.query("UPDATE ai_runs SET step=?,messages=? WHERE id=?").run(step, JSON.stringify(messages), id);
  }
  emit(id: string, event: TSessionEvent) {
    this.db.query("INSERT INTO ai_events(run,event) VALUES(?,?)").run(id, JSON.stringify(event));
  }
  events(id: string, after: number) {
    return this.db.query<{seq:number;event:string}, [string,number]>(
      "SELECT seq,event FROM ai_events WHERE run=? AND seq>? ORDER BY seq LIMIT 256").all(id, after);
  }
  finish(id: string, event: Extract<TSessionEvent, { type: "done" | "failed" }>) {
    this.db.transaction(() => {
      this.db.query("UPDATE ai_runs SET status=? WHERE id=?").run(event.type === "done" ? "completed" : "failed", id);
      this.emit(id, event);
    })();
  }
}
