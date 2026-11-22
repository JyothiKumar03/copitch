import type { Database } from "bun:sqlite";
import type { TMission, TMissionDecision, TMissionRetryPhase, TMissionStep, TOutcomeContract } from "../types/mission";
import { AppError } from "../errors/app-error";

export const mission_step = (mission: TMission, tool: TMissionStep["tool"], summary: string) => {
  mission.steps.push({ sequence: mission.steps.length + 1, tool, summary, at: Date.now(), spent_usd: mission.spent_usd, reserved_usd: mission.reserved_usd, contract_revision: mission.contract.revision });
};

export class MissionRepository {
  constructor(private db: Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS missions (
      mission_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS mission_owner ON missions(session_id);
      CREATE INDEX IF NOT EXISTS mission_runnable ON missions(status);
      CREATE TABLE IF NOT EXISTS mission_revisions (mission_id TEXT NOT NULL, revision INTEGER NOT NULL, session_id TEXT NOT NULL,
        payload TEXT NOT NULL, PRIMARY KEY(mission_id,revision));
      CREATE TABLE IF NOT EXISTS mission_children (child_id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
        mission_id TEXT NOT NULL, revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS mission_tool_leases (mission_id TEXT NOT NULL, revision INTEGER NOT NULL, phase TEXT NOT NULL, lease_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL, PRIMARY KEY(mission_id,revision,phase));
      CREATE TABLE IF NOT EXISTS mission_retries (mission_id TEXT NOT NULL, revision INTEGER NOT NULL, phase TEXT NOT NULL,
        retry_id TEXT NOT NULL UNIQUE, PRIMARY KEY(mission_id,revision,phase));
      CREATE TABLE IF NOT EXISTS mission_pending_turns (session_id TEXT NOT NULL, turn_id TEXT NOT NULL, mission_id TEXT NOT NULL,
        revision INTEGER NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY(session_id,turn_id));
      CREATE TABLE IF NOT EXISTS mission_tool_results (mission_id TEXT NOT NULL, revision INTEGER NOT NULL, phase TEXT NOT NULL,
        payload TEXT NOT NULL, applied INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(mission_id,revision,phase));
      CREATE TABLE IF NOT EXISTS mission_costs (receipt_id TEXT PRIMARY KEY, mission_id TEXT NOT NULL,
        reserved_usd REAL NOT NULL, settled_usd REAL);`);
  }

  current(session: string): TMission | null {
    const row = this.db.query<{ payload: string }, [string]>(
      "SELECT payload FROM missions WHERE session_id=? ORDER BY rowid DESC LIMIT 1").get(session);
    return row ? JSON.parse(row.payload) as TMission : null;
  }

  get(session: string, id: string): TMission {
    const row = this.db.query<{ payload: string }, [string,string]>(
      "SELECT payload FROM missions WHERE session_id=? AND mission_id=?").get(session,id);
    if (!row) throw new AppError(404,"Mission unavailable.");
    return JSON.parse(row.payload) as TMission;
  }

  working() {
    return this.db.query<{ mission_id: string; session_id: string }, []>(
      "SELECT session_id,mission_id FROM missions WHERE status='working' ORDER BY rowid").all();
  }

  atomic<T>(apply: () => T) {
    return this.db.transaction(apply).immediate();
  }

  save(session: string, mission: TMission) {
    this.db.query(`INSERT INTO missions(mission_id,session_id,status,payload) VALUES(?,?,?,?)
      ON CONFLICT(mission_id) DO UPDATE SET status=excluded.status,payload=excluded.payload
      WHERE missions.session_id=excluded.session_id`).run(mission.mission_id,session,mission.status,JSON.stringify(mission));
    this.db.query(`INSERT INTO mission_revisions VALUES(?,?,?,?) ON CONFLICT(mission_id,revision)
      DO UPDATE SET payload=excluded.payload WHERE mission_revisions.session_id=excluded.session_id`)
      .run(mission.mission_id,mission.contract.revision,session,JSON.stringify(mission));
    return mission;
  }

  revision(session: string, id: string, revision: number): TMission {
    const row = this.db.query<{ payload: string }, [string,string,number]>(
      "SELECT payload FROM mission_revisions WHERE session_id=? AND mission_id=? AND revision=?").get(session,id,revision);
    if (!row) throw new AppError(404,"Mission revision unavailable.");
    return JSON.parse(row.payload) as TMission;
  }

  proposal(session: string, contract: TOutcomeContract, proposal_id: string) {
    return this.atomic(() => {
      const old = this.current(session);
      if (old?.proposal_id === proposal_id) return old;
      const active = old && !["delivered","stopped","paused"].includes(old.status) ? old : null;
      if (active) return this.revise(session,active.mission_id,active.contract.revision,contract,proposal_id);
      const mission: TMission = { mission_id: crypto.randomUUID(), proposal_id, contract, previous_contract: null,
        status: "needs_approval", approved_revision: null, started_at: null, research_job_id: null, brief_id: null,
        research_id: null, deck_job_id: null, deck_id: null, deck_revision: null, spent_usd: 0, reserved_usd: 0, gaps: [], steps: [] };
      mission_step(mission,"set_contract","Review the outcome, sources and budget.");
      return this.save(session,mission);
    });
  }

  change(session: string, id: string, revision: number, update: (mission: TMission) => void) {
    return this.atomic(() => {
      const mission = this.get(session,id);
      if (mission.contract.revision !== revision || this.current(session)?.mission_id !== id) throw new AppError(409,"The plan changed. Review its current revision.");
      update(mission);
      return this.save(session,mission);
    });
  }

  revise(session: string, id: string, revision: number, contract: TOutcomeContract, proposal_id: string | null = null) {
    return this.change(session,id,revision,mission => {
      if (contract.budget.usd < mission.spent_usd + mission.reserved_usd) throw new AppError(409,"The new budget is below costs already committed.");
      mission.previous_contract = mission.contract;
      mission.contract = { ...contract, contract_id: mission.contract.contract_id, revision: revision + 1 };
      mission.proposal_id = proposal_id;
      mission.status = "needs_approval";
      mission.gaps = [];
      mission_step(mission,"set_contract","Review the revised outcome and source scope.");
    });
  }

  bind(session: string, mission: TMission, child_id: string) {
    this.db.query(`INSERT OR IGNORE INTO mission_children VALUES(?,?,?,?)`).run(child_id,session,mission.mission_id,mission.contract.revision);
  }

  owns_child(session: string, mission_id: string, revision: number, child_id: string) {
    return !!this.db.query("SELECT 1 FROM mission_children WHERE session_id=? AND mission_id=? AND revision=? AND child_id=?")
      .get(session,mission_id,revision,child_id);
  }

  claim_tool(mission: TMission, phase: "plan" | "review") {
    const now = Date.now();
    const existing = this.db.query<{ expires_at: number; attempts: number }, [string,number,string]>(
      "SELECT expires_at,attempts FROM mission_tool_leases WHERE mission_id=? AND revision=? AND phase=?").get(mission.mission_id,mission.contract.revision,phase);
    if (existing && existing.expires_at > now) return;
    if (existing && existing.attempts >= 2) throw new AppError(422,phase === "plan" ? "The preparation decision was interrupted twice. Review the saved research." : "The outcome check was interrupted twice. Review the saved deck.");
    const lease = crypto.randomUUID();
    this.db.query(`INSERT INTO mission_tool_leases VALUES(?,?,?,?,?,1) ON CONFLICT(mission_id,revision,phase)
      DO UPDATE SET expires_at=excluded.expires_at,lease_id=excluded.lease_id,attempts=attempts+1`)
      .run(mission.mission_id,mission.contract.revision,phase,lease,now+60000);
    return lease;
  }

  tool_owned(mission: TMission, lease: string) {
    return !!this.db.query("SELECT 1 FROM mission_tool_leases WHERE mission_id=? AND revision=? AND lease_id=? AND expires_at>?")
      .get(mission.mission_id,mission.contract.revision,lease,Date.now());
  }

  begin_turn(session: string, id: string, revision: number, turn_id: string) {
    const m = this.current(session);
    if (m?.mission_id !== id || m.contract.revision !== revision || m.status !== "working") return;
    this.db.query("INSERT OR IGNORE INTO mission_pending_turns VALUES(?,?,?,?,?)").run(session,turn_id,id,revision,Date.now()+55000);
  }

  end_turn(session: string, turn_id: string) {
    this.db.query("DELETE FROM mission_pending_turns WHERE session_id=? AND turn_id=?").run(session,turn_id);
  }

  host_speaking(m: TMission) {
    return !!this.db.query("SELECT 1 FROM mission_pending_turns WHERE mission_id=? AND revision=? AND expires_at>? LIMIT 1")
      .get(m.mission_id,m.contract.revision,Date.now());
  }

  record_decision(m: TMission, phase: "plan" | "review", decision: TMissionDecision) {
    this.db.query("INSERT OR IGNORE INTO mission_tool_results(mission_id,revision,phase,payload) VALUES(?,?,?,?)")
      .run(m.mission_id,m.contract.revision,phase,JSON.stringify(decision));
  }

  take_decision(m: TMission) {
    const row = this.db.query<{ payload: string },[string,number]>(
      "UPDATE mission_tool_results SET applied=1 WHERE mission_id=? AND revision=? AND applied=0 RETURNING payload").get(m.mission_id,m.contract.revision);
    return row ? JSON.parse(row.payload) as TMissionDecision : undefined;
  }

  retry_recorded(m: TMission, phase: TMissionRetryPhase) {
    return !!this.db.query("SELECT 1 FROM mission_retries WHERE mission_id=? AND revision=? AND phase=?")
      .get(m.mission_id,m.contract.revision,phase);
  }

  replay_retry(m: TMission, retry_id: string) {
    return !!this.db.query("SELECT 1 FROM mission_retries WHERE mission_id=? AND revision=? AND retry_id=?")
      .get(m.mission_id,m.contract.revision,retry_id);
  }

  failed_model_phase(m: TMission) {
    const row = this.db.query<{ phase: "plan" | "review"; payload: string; attempts: number },[string,number]>(`
      SELECT r.phase,r.payload,l.attempts FROM mission_tool_results r JOIN mission_tool_leases l USING(mission_id,revision,phase)
      WHERE r.mission_id=? AND r.revision=? AND r.applied=1 AND r.phase IN ('plan','review') ORDER BY r.rowid DESC LIMIT 1
    `).get(m.mission_id,m.contract.revision);
    if (!row || row.attempts >= 2) return;
    const result = JSON.parse(row.payload) as TMissionDecision;
    if (result.tool === "ask_host" && (result.transient === row.phase || result.gaps.some(text =>
      /^(?:Connect a priced Director model|The Director could not finish its next step)/u.test(text)))) return row.phase;
  }

  record_retry(m: TMission, phase: TMissionRetryPhase, retry_id: string) {
    this.db.query("INSERT INTO mission_retries VALUES(?,?,?,?)").run(m.mission_id,m.contract.revision,phase,retry_id);
    if (phase === "plan" || phase === "review") {
      // Keep the rejected result and its usage receipts. Only this failed checkpoint gets another decision.
      this.db.query("UPDATE mission_tool_results SET phase=? WHERE mission_id=? AND revision=? AND phase=?")
        .run(phase+"-initial",m.mission_id,m.contract.revision,phase);
      this.db.query("UPDATE mission_tool_leases SET expires_at=0 WHERE mission_id=? AND revision=? AND phase=?")
        .run(m.mission_id,m.contract.revision,phase);
    }
  }

  mission_meter(session: string, child_id: string) {
    const owner = this.db.query<{ mission_id: string; revision: number }, [string,string]>(
      "SELECT mission_id,revision FROM mission_children WHERE session_id=? AND child_id=?").get(session,child_id);
    if (!owner) return;
    return {
      reserve: (usd: number) => this.reserve(session,child_id,usd)!,
      settle: (receipt: string, usd: number | null, retained_usd = 0) => this.settle(session,receipt,usd,retained_usd),
      assert_active: () => {
        const m = this.get(session,owner.mission_id);
        if (m.status !== "working" || m.approved_revision !== owner.revision || !m.started_at ||
            Date.now() >= m.started_at + m.contract.budget.minutes * 60000) throw new AppError(422,"The mission stopped or its approved scope expired.");
      },
    };
  }

  reserve(session: string, child_id: string, usd: number) {
    return this.atomic(() => {
      const owner = this.db.query<{ mission_id: string; revision: number }, [string,string]>(
        "SELECT mission_id,revision FROM mission_children WHERE session_id=? AND child_id=?").get(session,child_id);
      if (!owner) return null;
      const mission = this.get(session,owner.mission_id);
      if (mission.status !== "working" || mission.approved_revision !== owner.revision || !mission.started_at ||
          Date.now() >= mission.started_at + mission.contract.budget.minutes * 60000) throw new AppError(422,"Mission paused or time limit reached.");
      if (!Number.isFinite(usd) || usd <= 0 || mission.spent_usd + mission.reserved_usd + usd > mission.contract.budget.usd)
        throw new AppError(422,"The next provider call exceeds the remaining mission budget or has no verified price.");
      const receipt_id = crypto.randomUUID();
      this.db.query("INSERT INTO mission_costs VALUES(?,?,?,NULL)").run(receipt_id,mission.mission_id,usd);
      mission.reserved_usd += usd;
      this.save(session,mission);
      return receipt_id;
    });
  }

  settle(session: string, receipt_id: string, usd: number | null, retained_usd = 0) {
    this.atomic(() => {
      const receipt = this.db.query<{ mission_id: string; reserved_usd: number }, [string]>(
        "SELECT mission_id,reserved_usd FROM mission_costs WHERE receipt_id=? AND settled_usd IS NULL").get(receipt_id);
      if (!receipt) return;
      const mission = this.get(session,receipt.mission_id);
      // Unknown billing keeps the upper bound reserved, including across process restarts.
      if (usd === null || !Number.isFinite(usd) || usd < 0 || !Number.isFinite(retained_usd) || retained_usd < 0) return;
      this.db.query("UPDATE mission_costs SET settled_usd=? WHERE receipt_id=?").run(usd,receipt_id);
      mission.reserved_usd = Math.max(0,mission.reserved_usd - receipt.reserved_usd) + retained_usd;
      mission.spent_usd += usd;
      this.save(session,mission);
    });
  }
}
