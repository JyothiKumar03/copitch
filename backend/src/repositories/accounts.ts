import type { Database } from "bun:sqlite";

type TAccount = { id: string; email: string; password_hash: string };
type TProject = { session_id: string; name: string; created_at: number };

export class AccountRepository {
  constructor(private db: Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS studio_accounts (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS studio_logins (
        token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS studio_logins_expiry ON studio_logins(expires_at);
      CREATE TABLE IF NOT EXISTS studio_projects (
        session_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS studio_projects_owner ON studio_projects(account_id, created_at);
    `);
  }
  register(id: string, email: string, password_hash: string) {
    return this.db.query("INSERT OR IGNORE INTO studio_accounts VALUES (?, ?, ?)").run(id, email, password_hash).changes === 1;
  }
  account(email: string) {
    return this.db.query<TAccount, [string]>("SELECT * FROM studio_accounts WHERE email=?").get(email);
  }
  login(token_hash: string, account_id: string, expires_at: number) {
    this.db.query("DELETE FROM studio_logins WHERE expires_at <= ?").run(Date.now());
    this.db.query("INSERT INTO studio_logins VALUES (?, ?, ?)").run(token_hash, account_id, expires_at);
  }
  identity(token_hash: string) {
    return this.db.query<Pick<TAccount, "id" | "email">, [string, number]>(
      "SELECT a.id, a.email FROM studio_logins l JOIN studio_accounts a ON a.id=l.account_id WHERE l.token_hash=? AND l.expires_at>?"
    ).get(token_hash, Date.now());
  }
  logout(token_hash: string) {
    this.db.query("DELETE FROM studio_logins WHERE token_hash=?").run(token_hash);
  }
  list(account_id: string) {
    return this.db.query<TProject, [string]>(
      "SELECT session_id,name,created_at FROM studio_projects WHERE account_id=? ORDER BY created_at DESC, session_id"
    ).all(account_id);
  }
  owns(account_id: string, session_id: string) {
    return Boolean(this.db.query("SELECT 1 FROM studio_projects WHERE account_id=? AND session_id=?").get(account_id, session_id));
  }
  claim_project(account_id: string, session_id: string, token_hash: string, name: string) {
    return this.db.transaction(() => {
      const claimed = this.db.query("UPDATE ai_sessions SET token_hash='' WHERE id=? AND token_hash=?").run(session_id, token_hash);
      if (!claimed.changes) return null;
      const project = { session_id, name, created_at: Date.now() };
      this.db.query("INSERT INTO studio_projects VALUES (?, ?, ?, ?)").run(session_id, account_id, name, project.created_at);
      return project;
    }).immediate();
  }
  create_project(account_id: string, name: string) {
    return this.db.transaction(() => {
      const project = { session_id: crypto.randomUUID(), name, created_at: Date.now() };
      this.db.query("INSERT INTO ai_sessions(id,token_hash) VALUES (?, '')").run(project.session_id);
      this.db.query("INSERT INTO studio_projects VALUES (?, ?, ?, ?)").run(project.session_id, account_id, name, project.created_at);
      return project;
    })();
  }
}
