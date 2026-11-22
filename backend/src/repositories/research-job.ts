import type { Database } from "bun:sqlite";
import { AppError } from "../errors/app-error";
import { record_studio_update } from "../services/studio-events";
import type { TResearchBundle } from "../types/research";
import type { TActivityKind, TResearchActivity, TResearchCheckpoint, TResearchJob, TResearchLease } from "../types/research-job";

const max_attempts = 3;
const lease_ms = 15000;

export class ResearchJobRepository {
  constructor(private db: Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS research_jobs (
        job_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, brief_id TEXT NOT NULL,
        status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, available_at INTEGER NOT NULL DEFAULT 0,
        lease_token TEXT, lease_until INTEGER, checkpoint TEXT, error TEXT,
        UNIQUE(session_id,brief_id));
      CREATE TABLE IF NOT EXISTS research_activity (
        job_id TEXT NOT NULL, sequence INTEGER NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL,
        PRIMARY KEY(job_id,sequence));
      CREATE TABLE IF NOT EXISTS research_progress_turns (
        turn_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, job_id TEXT NOT NULL, after_turn INTEGER NOT NULL,
        question TEXT NOT NULL, answer TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS research_turns_session ON research_progress_turns(session_id);
      CREATE INDEX IF NOT EXISTS research_jobs_queue ON research_jobs(status,available_at,lease_until);
    `);
  }

  private append(id: string, kind: TActivityKind, label: string) {
    this.db.query(`INSERT INTO research_activity(job_id,sequence,kind,label)
      SELECT ?,COALESCE(MAX(sequence),0)+1,?,? FROM research_activity WHERE job_id=?`).run(id,kind,label,id);
    const job = this.db.query<{session_id: string}, [string]>(
      "SELECT session_id FROM research_jobs WHERE job_id=?").get(id);
    if (job) record_studio_update(this.db, job.session_id, "job", id);
  }

  record(lease: TResearchLease, kind: TActivityKind, label: string) {
    this.db.transaction(() => {
      this.assert_owner(lease);
      this.append(lease.job_id,kind,label);
    }).immediate();
  }

  for_brief(session: string, brief: string): TResearchJob | undefined {
    const row = this.db.query<{job_id:string}, [string,string]>(
      "SELECT job_id FROM research_jobs WHERE session_id=? AND brief_id=?").get(session,brief);
    if (row) return this.get(session,row.job_id);
  }

  progress_turns(session: string) {
    return this.db.query<{ question: string; answer: string; after_turn: number }, [string]>(
      "SELECT question,answer,after_turn FROM research_progress_turns WHERE session_id=? ORDER BY after_turn,rowid").all(session);
  }

  record_progress(session: string, job: string, turn_id: string, after_turn: number, question: string, answer: string) {
    this.db.query("INSERT OR IGNORE INTO research_progress_turns VALUES(?,?,?,?,?,?)")
      .run(turn_id, session, job, after_turn, question, answer);
    const saved = this.db.query<{ question: string; answer: string }, [string, string, string]>(
      "SELECT question,answer FROM research_progress_turns WHERE session_id=? AND job_id=? AND turn_id=?").get(session, job, turn_id);
    if (!saved || saved.question !== question) throw new AppError(409, "Progress turn identity changed");
    return saved.answer;
  }

  progress_answer(session: string, turn_id: string) {
    return this.db.query<{ answer: string }, [string, string]>(
      "SELECT answer FROM research_progress_turns WHERE session_id=? AND turn_id=?").get(session, turn_id)?.answer;
  }

  enqueue(session: string, brief: string, retry = false,
    approval?: { after_turn: number; question: string; answer: string }): TResearchJob {
    return this.db.transaction(() => {
      const current = this.db.query("SELECT 1 FROM research_briefs WHERE session=? AND id=?").get(session,brief);
      if (!current) throw new AppError(409, "Brief revision is stale");
      const bundle = this.db.query("SELECT id FROM research_bundles WHERE session=? AND brief=?").get(session,brief);
      const inserted = this.db.query(`INSERT INTO research_jobs(job_id,session_id,brief_id,status) VALUES(?,?,?,?)
        ON CONFLICT(session_id,brief_id) DO NOTHING`).run(crypto.randomUUID(),session,brief,bundle ? "completed" : "queued");
      const retried = retry && this.db.query(`UPDATE research_jobs SET status='queued',attempts=0,error=NULL,available_at=0
        WHERE session_id=? AND brief_id=? AND status='failed'`).run(session,brief);
      const row = this.db.query<{job_id:string}, [string,string]>(
        "SELECT job_id FROM research_jobs WHERE session_id=? AND brief_id=?").get(session,brief)!;
      if (inserted.changes) {
        this.append(row.job_id,bundle ? "completed" : "queued",bundle ? "Loaded the saved research report." : "Research queued.");
      } else if (retried && retried.changes) this.append(row.job_id,"queued","Research queued for retry.");
      if (approval && (inserted.changes || (retried && retried.changes))) {
        this.record_progress(session, row.job_id, crypto.randomUUID(), approval.after_turn, approval.question, approval.answer);
      }
      return this.get(session,row.job_id)!;
    }).immediate();
  }

  get(session: string, id: string): TResearchJob | undefined {
    const row = this.db.query<{
      job_id:string;brief_id:string;status:TResearchJob["status"];completed_lookups:number;tool_steps:number|null;
      research_passes:number|null;read_pages:number|null;error:string|null;payload:string|null;
    },[string,string]>(`SELECT j.job_id,j.brief_id,j.status,j.error,
      COALESCE(json_extract(j.checkpoint,'$.completed_lookups'),0) AS completed_lookups,
      json_extract(j.checkpoint,'$.collection.lookup_attempts') AS tool_steps,
      json_extract(j.checkpoint,'$.collection.pass') AS research_passes,
      COALESCE(json_extract(j.checkpoint,'$.collection.read_pages'), CASE WHEN json_type(j.checkpoint,'$.collection.targets')='array' THEN
        (SELECT COUNT(DISTINCT COALESCE(json_extract(value,'$.canonical_url'),json_extract(value,'$.value')))
         FROM json_each(j.checkpoint,'$.collection.targets')
         WHERE json_extract(value,'$.kind')='read' AND json_array_length(value,'$.evidence_ids')>0) END) AS read_pages,b.payload
      FROM research_jobs j LEFT JOIN research_bundles b ON b.session=j.session_id AND b.brief=j.brief_id AND j.status='completed'
      WHERE j.session_id=? AND j.job_id=?`).get(session,id);
    if (!row) return;
    const {payload,error,tool_steps,research_passes,read_pages,...state} = row;
    const activity = this.db.query<TResearchActivity,[string]>(
      "SELECT sequence,kind,label FROM research_activity WHERE job_id=? ORDER BY sequence").all(id);
    const job = { ...state, activity, ...(tool_steps !== null && { tool_steps }), ...(research_passes !== null && { research_passes }),
      ...(read_pages !== null && { read_pages }) };
    if (payload) {
      const {research_id,markdown,gaps} = JSON.parse(payload) as TResearchBundle;
      return { ...job, result:{research_id,markdown,gaps} };
    }
    const message = error && /OPENAI_(?:API_KEY|TEXT_MODELS|BASE_URL)/u.test(error) ? "The research service is unavailable. Try again when it is connected." : error;
    return message ? { ...job,error: message } : job;
  }

  stop(session: string, brief: string, id: string) {
    this.db.transaction(() => {
      const row = this.db.query<{job_id:string},[string,string,string]>(`UPDATE research_jobs SET status='stopped',
        error='Research stopped. Saved work remains available.',lease_token=NULL,lease_until=NULL
        WHERE session_id=? AND brief_id=? AND job_id=? AND status IN ('queued','running')
        AND EXISTS (SELECT 1 FROM research_briefs WHERE session=research_jobs.session_id AND id=research_jobs.brief_id)
        RETURNING job_id`).get(session,brief,id);
      if (row) this.append(row.job_id,"stopped","Research stopped. Saved work remains available.");
    }).immediate();
  }

  supersede(session: string, new_brief: string) {
    const rows = this.db.query<{job_id:string},[string,string]>(`UPDATE research_jobs SET status='superseded',error='Research scope changed',lease_token=NULL,lease_until=NULL
      WHERE session_id=? AND brief_id<>? AND status IN ('queued','running','failed') RETURNING job_id`).all(session,new_brief);
    for (const row of rows) this.append(row.job_id,"superseded","The host changed the research scope.");
  }

  claim(id?: string, now = Date.now()): TResearchLease | undefined {
    return this.db.transaction(() => {
      const expired = this.db.query<{job_id:string},[number,number]>(`UPDATE research_jobs SET status='failed',lease_token=NULL,lease_until=NULL,error='Worker restart limit reached'
        WHERE status='running' AND lease_until<=? AND attempts>=? RETURNING job_id`).all(now,max_attempts);
      for (const row of expired) this.append(row.job_id,"failed","Worker stopped before completing the research.");
      const row = this.db.query<{job_id:string;session_id:string;brief_id:string;checkpoint:string|null;attempts:number},[string|null,string|null,number,number]>(`
        SELECT job_id,session_id,brief_id,checkpoint,attempts FROM research_jobs
        WHERE (? IS NULL OR job_id=?) AND ((status='queued' AND available_at<=?) OR (status='running' AND lease_until<=?))
        ORDER BY available_at,rowid LIMIT 1`).get(id ?? null,id ?? null,now,now);
      if (!row) return;
      const token = crypto.randomUUID();
      this.db.query(`UPDATE research_jobs SET status='running',attempts=attempts+1,lease_token=?,lease_until=?,error=NULL
        WHERE job_id=?`).run(token,now+lease_ms,row.job_id);
      this.append(row.job_id,row.attempts || row.checkpoint ? "resumed" : "started",
        row.checkpoint ? "Resumed from the saved research checkpoint." : row.attempts ? "Restarted the research attempt." : "Research worker started.");
      return { ...row,token,checkpoint:row.checkpoint ? JSON.parse(row.checkpoint) as TResearchCheckpoint : undefined };
    }).immediate();
  }

  assert_owner(lease: TResearchLease, now = Date.now()) {
    const owned = this.db.query(`SELECT 1 FROM research_jobs j JOIN research_briefs b ON b.session=j.session_id AND b.id=j.brief_id
      WHERE j.job_id=? AND j.status='running' AND j.lease_token=? AND j.lease_until>?`).get(lease.job_id,lease.token,now);
    if (!owned) throw new AppError(409, "Research lease or scope changed");
  }

  renew(lease: TResearchLease, now = Date.now()) {
    const result = this.db.query(`UPDATE research_jobs SET lease_until=? WHERE job_id=? AND status='running'
      AND lease_token=? AND lease_until>?`).run(now+lease_ms,lease.job_id,lease.token,now);
    return result.changes === 1;
  }

  checkpoint(lease: TResearchLease, state: TResearchCheckpoint) {
    this.db.transaction(() => {
      this.assert_owner(lease);
      this.db.query("UPDATE research_jobs SET checkpoint=? WHERE job_id=?").run(JSON.stringify(state),lease.job_id);
    }).immediate();
  }

  complete(lease: TResearchLease, bundle: TResearchBundle) {
    this.db.transaction(() => {
      this.assert_owner(lease);
      if (bundle.brief_id !== lease.brief_id) throw new Error("Mismatched research bundle");
      this.db.query("INSERT INTO research_bundles(id,session,brief,payload) VALUES(?,?,?,?)")
        .run(bundle.research_id,lease.session_id,lease.brief_id,JSON.stringify(bundle));
      this.append(lease.job_id,"completed","Saved the research report and its source index.");
      this.db.query("UPDATE research_jobs SET status='completed',lease_token=NULL,lease_until=NULL WHERE job_id=?").run(lease.job_id);
    }).immediate();
  }

  request_input(lease: TResearchLease, message: string) {
    this.db.transaction(() => {
      this.assert_owner(lease);
      this.db.query("UPDATE research_jobs SET status='needs_input',error=?,lease_token=NULL,lease_until=NULL WHERE job_id=?")
        .run(message, lease.job_id);
      this.append(lease.job_id, "needs_input", message);
    }).immediate();
  }

  fail(lease: TResearchLease, reason: string, now = Date.now()) {
    this.db.transaction(() => {
      const row = this.db.query<{status:string}, [number,string,number,string,string,number]>(`
        UPDATE research_jobs SET status=CASE WHEN attempts>=? THEN 'failed' ELSE 'queued' END,
        error=?,available_at=?,lease_token=NULL,lease_until=NULL WHERE job_id=? AND status='running'
        AND lease_token=? AND lease_until>? RETURNING status`).get(max_attempts,reason,now+1000,lease.job_id,lease.token,now);
      if (row) this.append(lease.job_id,row.status === "failed" ? "failed" : "queued",
        row.status === "failed" ? "Research stopped after its retry limit." : "Research interrupted; retry queued.");
    }).immediate();
  }
}
