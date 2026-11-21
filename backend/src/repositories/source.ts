import type { Database } from "bun:sqlite";
import { AppError } from "../errors/app-error";
import type { TParserCall, TSourceKind, TSourceSummary, TUploadedSource } from "../types/source";
import { source_formats } from "../constants/sources";
import { record_studio_update } from "../services/studio-events";

export class SourceRepository {
  constructor(private db: Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS research_sources (
      id TEXT PRIMARY KEY, session TEXT NOT NULL, payload TEXT NOT NULL, digest TEXT NOT NULL,
      UNIQUE(session,digest));
      CREATE TABLE IF NOT EXISTS source_parser_calls (
        call_id TEXT PRIMARY KEY, session TEXT NOT NULL, filename TEXT NOT NULL, tool TEXT NOT NULL,
        status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, source TEXT, error TEXT);
      CREATE INDEX IF NOT EXISTS parser_calls_session ON source_parser_calls(session, started_at);`);
    db.query(`UPDATE source_parser_calls SET status='failed', finished_at=?, error='Parsing stopped when the server restarted. Attach the file again.'
      WHERE status='running'`).run(new Date().toISOString());
  }

  start_call(session: string, filename: string, kind: TSourceKind) {
    const call_id = crypto.randomUUID();
    this.db.transaction(() => {
      this.db.query(`INSERT INTO source_parser_calls(call_id,session,filename,tool,status,started_at)
        VALUES(?,?,?,?,'running',?)`).run(call_id, session, filename, source_formats[kind].tool, new Date().toISOString());
      record_studio_update(this.db, session, "sources", call_id);
    })();
    return call_id;
  }

  private finish_call(session: string, call_id: string, source: TSourceSummary | null, error: string | null) {
    this.db.query(`UPDATE source_parser_calls SET status=?, finished_at=?, source=?, error=?
      WHERE call_id=? AND session=? AND status='running'`).run(source ? "succeeded" : "failed", new Date().toISOString(),
        source && JSON.stringify(source), error, call_id, session);
    record_studio_update(this.db, session, "sources", call_id);
  }

  fail_call(session: string, call_id: string, error: string) {
    this.db.transaction(() => this.finish_call(session, call_id, null, error))();
  }

  calls(session: string): TParserCall[] {
    const rows = this.db.query<Omit<TParserCall, "source"> & {source: string | null}, [string]>(
      `SELECT call_id, filename, tool, status, started_at, finished_at, source, error
       FROM source_parser_calls WHERE session=? ORDER BY rowid`).all(session);
    return rows.map(row => ({ ...row, source: row.source ? JSON.parse(row.source) as TSourceSummary : null }));
  }

  save(session: string, digest: string, source: TUploadedSource, call_id?: string): TSourceSummary {
    return this.db.transaction(() => {
      this.db.query("INSERT OR IGNORE INTO research_sources VALUES(?,?,?,?)")
        .run(source.source_id, session, JSON.stringify(source), digest);
      const row = this.db.query<{payload:string},[string,string]>(
        "SELECT payload FROM research_sources WHERE session=? AND digest=?").get(session,digest)!;
      const summary = source_summary(JSON.parse(row.payload));
      if (call_id) this.finish_call(session, call_id, summary, null);
      return summary;
    }).immediate();
  }

  selected(session: string, ids: string[]): TUploadedSource[] {
    const get = this.db.query<{payload:string}, [string,string]>("SELECT payload FROM research_sources WHERE session=? AND id=?");
    return ids.map(id => {
      const row = get.get(session,id);
      if (!row) throw new AppError(404,"Unknown research source");
      return JSON.parse(row.payload) as TUploadedSource;
    });
  }
}

export const source_summary = ({ source_id, filename, kind, locations }: TUploadedSource): TSourceSummary =>
  ({ source_id, filename, kind, locations });
