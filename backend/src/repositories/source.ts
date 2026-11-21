import type { Database } from "bun:sqlite";
import { AppError } from "../errors/app-error";
import type { TSourceSummary, TUploadedSource } from "../types/source";

export class SourceRepository {
  constructor(private db: Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS research_sources (
      id TEXT PRIMARY KEY, session TEXT NOT NULL, payload TEXT NOT NULL, digest TEXT NOT NULL,
      UNIQUE(session,digest));`);
  }

  save(session: string, digest: string, source: TUploadedSource): TSourceSummary {
    return this.db.transaction(() => {
      this.db.query("INSERT OR IGNORE INTO research_sources VALUES(?,?,?,?)")
        .run(source.source_id, session, JSON.stringify(source), digest);
      const row = this.db.query<{payload:string},[string,string]>(
        "SELECT payload FROM research_sources WHERE session=? AND digest=?").get(session,digest)!;
      return source_summary(JSON.parse(row.payload));
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
