import type { Database } from "bun:sqlite";
import type { TWalkthroughSelectionExport } from "../../../shared/walkthrough-selection";
import { AppError } from "../errors/app-error";

export type TWalkthroughExportScope = { session: string; kind: "site-runs" | "website-walkthroughs"; capture: string };
type TManifest = Pick<TWalkthroughSelectionExport, "source_revision" | "items" | "item_ids" | "host_additions" | "slides">;
type TExportRow = { export_id: string; revision: number; manifest: string; created_at: number };
const columns = "export_id, revision, manifest, created_at";
const project = (row: TExportRow): TWalkthroughSelectionExport => ({
  export_id: row.export_id, revision: row.revision, created_at: row.created_at, ...JSON.parse(row.manifest) as TManifest,
});

export class WalkthroughExportRepository {
  constructor(private db: Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS walkthrough_exports (
      export_id TEXT PRIMARY KEY, session TEXT NOT NULL, kind TEXT NOT NULL, capture TEXT NOT NULL,
      revision INTEGER NOT NULL, scope_hash TEXT NOT NULL, manifest TEXT NOT NULL, created_at INTEGER NOT NULL, powerpoint BLOB NOT NULL,
      UNIQUE(session,kind,capture,scope_hash), UNIQUE(session,kind,capture,revision));
      CREATE TABLE IF NOT EXISTS walkthrough_export_requests (
      session TEXT NOT NULL, kind TEXT NOT NULL, capture TEXT NOT NULL, request_id TEXT NOT NULL, scope_hash TEXT NOT NULL,
      PRIMARY KEY(session,kind,capture,request_id));`);
  }

  list({ session, kind, capture }: TWalkthroughExportScope) {
    return this.db.query<TExportRow, [string,string,string]>(`SELECT ${columns} FROM walkthrough_exports
      WHERE session=? AND kind=? AND capture=? ORDER BY revision DESC`).all(session, kind, capture).map(project);
  }

  private matching({ session, kind, capture }: TWalkthroughExportScope, hash: string) {
    return this.db.query<TExportRow, [string,string,string,string]>(`SELECT ${columns} FROM walkthrough_exports
      WHERE session=? AND kind=? AND capture=? AND scope_hash=?`).get(session, kind, capture, hash);
  }

  // Bind every confirmation ID, including retries that select the same content under a second ID.
  save(scope: TWalkthroughExportScope, request: string, hash: string, manifest: TManifest, bytes?: Buffer) {
    return this.db.transaction(() => {
      const { session, kind, capture } = scope;
      const previous = this.db.query<{scope_hash: string}, [string,string,string,string]>(
        "SELECT scope_hash FROM walkthrough_export_requests WHERE session=? AND kind=? AND capture=? AND request_id=?"
      ).get(session, kind, capture, request);
      if (previous && previous.scope_hash !== hash) throw new AppError(409, "The confirmed content changed. Review it again.");
      let row = this.matching(scope, hash);
      if (!row && !bytes) return;
      if (!row && bytes) {
        row = this.db.query<TExportRow, [string,string,string,string,string,string,number,Buffer,string,string,string]>(`
          INSERT INTO walkthrough_exports(export_id,session,kind,capture,scope_hash,manifest,created_at,powerpoint,revision)
          SELECT ?,?,?,?,?,?,?,?,COALESCE(MAX(revision),0)+1 FROM walkthrough_exports WHERE session=? AND kind=? AND capture=?
          RETURNING ${columns}`).get(crypto.randomUUID(), session, kind, capture, hash, JSON.stringify(manifest), Date.now(), bytes, session, kind, capture);
      }
      if (!row) throw new AppError(500, "The PowerPoint could not be saved.");
      this.db.query("INSERT OR IGNORE INTO walkthrough_export_requests VALUES(?,?,?,?,?)").run(session, kind, capture, request, hash);
      return project(row);
    }).immediate();
  }

  download({ session, kind, capture }: TWalkthroughExportScope, id: string) {
    return this.db.query<{powerpoint: Uint8Array}, [string,string,string,string]>(
      "SELECT powerpoint FROM walkthrough_exports WHERE session=? AND kind=? AND capture=? AND export_id=?"
    ).get(session, kind, capture, id)?.powerpoint;
  }
}
