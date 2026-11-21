import type { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { AppError } from "../errors/app-error";
import type { TAudienceProjection } from "../types/audience";
import type { TDeck } from "../types/deck";

const ttl_ms = 60 * 60 * 1000;
const hash_token = (token: string) => createHash("sha256").update(token).digest("hex");

export class AudienceRepository {
  constructor(private db: Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS audience_stages(session TEXT NOT NULL,deck TEXT NOT NULL,sequence INTEGER NOT NULL,
        payload TEXT NOT NULL,PRIMARY KEY(session,deck));
      CREATE TABLE IF NOT EXISTS audience_tokens(hash TEXT PRIMARY KEY,session TEXT NOT NULL,deck TEXT NOT NULL,expires INTEGER NOT NULL);
    `);
  }

  private publish_slide(session: string, deck: TDeck, slide_id: string, expected?: number) {
    const index = deck.slides.findIndex(slide => slide.slide_id === slide_id);
    if (index === -1) throw new AppError(404, "Unknown slide");
    const prior = this.db.query<{sequence:number}, [string,string]>(
      "SELECT sequence FROM audience_stages WHERE session=? AND deck=?").get(session, deck.deck_id);
    const sequence = prior?.sequence ?? 0;
    if (expected !== undefined && expected !== sequence) throw new AppError(409, "Audience stage changed. Open a new audience view to resume publishing.");
    const slide = deck.slides[index];
    const projection: TAudienceProjection = {
      sequence: sequence + 1, revision: deck.revision, deck_title: deck.title, index, total: deck.slides.length,
      slide: { slide_id, layout: slide.layout, title: slide.title, highlights: slide.highlights, evidence_ids: slide.evidence_ids,
        chart: slide.chart, chart_period: slide.chart_period, template: slide.template },
    };
    this.db.query("INSERT OR REPLACE INTO audience_stages VALUES(?,?,?,?)")
      .run(session, deck.deck_id, projection.sequence, JSON.stringify(projection));
    return projection.sequence;
  }

  open(session: string, deck: TDeck, slide_id: string, replace_existing = false) {
    return this.db.transaction(() => {
      const sequence = this.publish_slide(session, deck, slide_id);
      const now = Date.now();
      const expires_at = now + ttl_ms;
      const token = randomBytes(32).toString("base64url");
      this.db.query("DELETE FROM audience_tokens WHERE expires<=?").run(now);
      if (replace_existing) this.db.query("DELETE FROM audience_tokens WHERE session=? AND deck=?").run(session, deck.deck_id);
      this.db.query("INSERT INTO audience_tokens VALUES(?,?,?,?)").run(hash_token(token), session, deck.deck_id, expires_at);
      return { token, sequence, expires_at };
    }).immediate();
  }

  scope(token: string, now = Date.now()) {
    return this.db.query<{ session: string; deck: string }, [string,number]>(
      "SELECT session,deck FROM audience_tokens WHERE hash=? AND expires>?").get(hash_token(token), now);
  }

  publish(session: string, deck: TDeck, slide_id: string, expected_sequence: number) {
    return this.db.transaction(() => ({ sequence: this.publish_slide(session, deck, slide_id, expected_sequence) })).immediate();
  }

  view(token: string, now = Date.now()): TAudienceProjection | undefined {
    const row = this.db.query<{payload:string}, [string,number]>(`
      SELECT s.payload FROM audience_tokens t JOIN audience_stages s ON s.session=t.session AND s.deck=t.deck
      WHERE t.hash=? AND t.expires>?`).get(hash_token(token), now);
    if (row) return JSON.parse(row.payload) as TAudienceProjection;
  }
}
