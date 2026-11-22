import type { Database } from "bun:sqlite";
import type { TWebsiteCaptureAttempt, TWebsiteWalkthrough, TWebsiteWalkthroughInput, TWebsiteWalkthroughPage } from "../../../shared/website-walkthrough";
import { AppError } from "../errors/app-error";

type TJobRow = Omit<TWebsiteWalkthrough, "pages" | "attempts" | "error"> & { attempts: string; pages: string; error: string | null };
type TCapturePage = TWebsiteWalkthroughPage & { screenshot: Buffer };
export type TWebsiteWalkthroughLease = Pick<TWebsiteWalkthrough, "walkthrough_id" | "url" | "goal" | "audience" | "max_depth"> & { lease_token: string };
const lease_ms = 25_000;

const project = ({ attempts, pages, error, ...row }: TJobRow): TWebsiteWalkthrough => ({
  ...row, attempts: JSON.parse(attempts), pages: JSON.parse(pages), ...(error && { error }),
});
const columns = "walkthrough_id,url,audience,goal,max_depth,created_at,status,attempts,pages,error";

export class WebsiteWalkthroughRepository {
  constructor(private db: Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS website_walkthroughs (
        walkthrough_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, request_id TEXT NOT NULL,
        url TEXT NOT NULL, audience TEXT NOT NULL, goal TEXT NOT NULL, max_depth INTEGER NOT NULL DEFAULT 2,
        created_at INTEGER NOT NULL, status TEXT NOT NULL,
        lease_token TEXT, lease_until INTEGER, runs INTEGER NOT NULL DEFAULT 0,
        attempts TEXT NOT NULL DEFAULT '[]', pages TEXT NOT NULL DEFAULT '[]', error TEXT, powerpoint BLOB,
        UNIQUE(session_id,request_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS website_walkthrough_active ON website_walkthroughs(session_id)
        WHERE status IN ('queued','capturing','exporting');
      CREATE TABLE IF NOT EXISTS website_walkthrough_images (
        walkthrough_id TEXT NOT NULL, capture_id INTEGER NOT NULL, screenshot BLOB NOT NULL,
        PRIMARY KEY(walkthrough_id,capture_id)
      );
    `);
    db.transaction(() => {
      const names = db.query<{ name: string }, []>("PRAGMA table_info(website_walkthroughs)").all();
      if (!names.some(column => column.name === "max_depth")) {
        db.exec("ALTER TABLE website_walkthroughs ADD COLUMN max_depth INTEGER NOT NULL DEFAULT 2");
      }
    }).immediate();
  }

  list(session: string) {
    return this.db.query<TJobRow, [string]>(`
      SELECT ${columns} FROM website_walkthroughs WHERE session_id=? ORDER BY rowid DESC LIMIT 24
    `).all(session).map(project);
  }

  get(session: string, id: string) {
    const row = this.db.query<TJobRow, [string, string]>(`
      SELECT ${columns} FROM website_walkthroughs WHERE session_id=? AND walkthrough_id=?
    `).get(session, id);
    return row ? project(row) : undefined;
  }

  enqueue(session: string, input: TWebsiteWalkthroughInput) {
    return this.db.transaction(() => {
      const repeated = this.db.query<TJobRow, [string, string]>(`
        SELECT ${columns} FROM website_walkthroughs WHERE session_id=? AND request_id=?
      `).get(session, input.request_id);
      if (repeated) {
        if (repeated.url !== input.url || repeated.audience !== input.audience || repeated.goal !== input.goal || repeated.max_depth !== input.max_depth) {
          throw new AppError(409, "This approval belongs to a different walkthrough. Review the new inputs.");
        }
        return project(repeated);
      }
      const active = this.db.query<TJobRow, [string]>(`
        SELECT ${columns} FROM website_walkthroughs WHERE session_id=? AND status IN ('queued','capturing','exporting')
      `).get(session);
      if (active) throw new AppError(409, "Finish the active website walkthrough before starting another.");
      const id = crypto.randomUUID();
      this.db.query(`INSERT INTO website_walkthroughs(walkthrough_id,session_id,request_id,url,audience,goal,max_depth,created_at,status)
        VALUES (?,?,?,?,?,?,?,?,'queued')`).run(id, session, input.request_id, input.url, input.audience, input.goal, input.max_depth, Date.now());
      return this.get(session, id)!;
    }).immediate();
  }

  claim(now = Date.now()) {
    return this.db.transaction(() => {
      this.db.query(`UPDATE website_walkthroughs SET status='failed',lease_token=NULL,lease_until=NULL,
        error='Capture was interrupted. Start another walkthrough to try again.'
        WHERE status IN ('capturing','exporting') AND lease_until<=? AND runs>=2`).run(now);
      this.db.query(`UPDATE website_walkthroughs SET status='queued',lease_token=NULL,lease_until=NULL,attempts='[]'
        WHERE status IN ('capturing','exporting') AND lease_until<=?`).run(now);
      if (this.db.query("SELECT 1 FROM website_walkthroughs WHERE status IN ('capturing','exporting') LIMIT 1").get()) return;
      return this.db.query<TWebsiteWalkthroughLease, [string, number]>(`
        UPDATE website_walkthroughs SET status='capturing',runs=runs+1,lease_token=?,lease_until=?
        WHERE walkthrough_id=(SELECT walkthrough_id FROM website_walkthroughs WHERE status='queued' ORDER BY rowid LIMIT 1)
        RETURNING walkthrough_id,url,audience,goal,max_depth,lease_token
      `).get(crypto.randomUUID(), now + lease_ms) ?? undefined;
    }).immediate();
  }

  renew(lease: TWebsiteWalkthroughLease, now = Date.now()) {
    return this.db.query(`UPDATE website_walkthroughs SET lease_until=? WHERE walkthrough_id=? AND lease_token=? AND lease_until>?`)
      .run(now + lease_ms, lease.walkthrough_id, lease.lease_token, now).changes === 1;
  }

  progress(lease: TWebsiteWalkthroughLease, attempts: TWebsiteCaptureAttempt[], exporting = false, now = Date.now()) {
    return this.db.query(`UPDATE website_walkthroughs SET attempts=?,status=?
      WHERE walkthrough_id=? AND lease_token=? AND lease_until>?`)
      .run(JSON.stringify(attempts), exporting ? "exporting" : "capturing", lease.walkthrough_id, lease.lease_token, now).changes === 1;
  }

  complete(lease: TWebsiteWalkthroughLease, pages: TCapturePage[], powerpoint?: Buffer, now = Date.now()) {
    return this.db.transaction(() => {
      const changed = this.db.query(`UPDATE website_walkthroughs SET status='completed',pages=?,powerpoint=?,lease_token=NULL,lease_until=NULL
        WHERE walkthrough_id=? AND status='exporting' AND lease_token=? AND lease_until>?`)
        .run(JSON.stringify(pages.map(({ capture_id, url, title, facts, depth }) => ({ capture_id, url, title, facts, depth }))),
          powerpoint ?? null, lease.walkthrough_id, lease.lease_token, now).changes;
      if (changed !== 1) return false;
      const insert = this.db.query("INSERT INTO website_walkthrough_images(walkthrough_id,capture_id,screenshot) VALUES(?,?,?)");
      for (const page of pages) insert.run(lease.walkthrough_id, page.capture_id, page.screenshot);
      return true;
    }).immediate();
  }

  fail(lease: TWebsiteWalkthroughLease, error: string, now = Date.now()) {
    this.db.query(`UPDATE website_walkthroughs SET status='failed',error=?,lease_token=NULL,lease_until=NULL
      WHERE walkthrough_id=? AND lease_token=? AND lease_until>?`).run(error, lease.walkthrough_id, lease.lease_token, now);
  }

  has_archived_export(session: string, id: string) {
    return Boolean(this.db.query("SELECT 1 FROM website_walkthroughs WHERE session_id=? AND walkthrough_id=? AND powerpoint IS NOT NULL")
      .get(session, id));
  }

  download(session: string, id: string) {
    return this.db.query<{ powerpoint: Uint8Array }, [string, string]>(`
      SELECT powerpoint FROM website_walkthroughs WHERE session_id=? AND walkthrough_id=? AND status='completed'
    `).get(session, id)?.powerpoint;
  }

  screenshot(session: string, id: string, capture: number) {
    return this.db.query<{ screenshot: Uint8Array }, [string, string, number]>(`
      SELECT i.screenshot FROM website_walkthrough_images i JOIN website_walkthroughs w ON w.walkthrough_id=i.walkthrough_id
      WHERE w.session_id=? AND w.walkthrough_id=? AND i.capture_id=? AND w.status='completed'
    `).get(session, id, capture)?.screenshot;
  }
}
